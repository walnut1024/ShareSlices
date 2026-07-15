use std::{
    collections::HashSet,
    io::Cursor,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use headless_chrome::protocol::cdp::{
    Fetch::{FulfillRequest, RequestPattern, RequestStage, events::RequestPausedEvent},
    Network,
    Page::CaptureScreenshotFormatOption,
    types::Event,
};
use headless_chrome::{
    Browser, LaunchOptionsBuilder,
    browser::tab::{RequestPausedDecision, Tab},
};
use image::{ImageFormat, imageops::FilterType};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use tempfile::NamedTempFile;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::object_storage::{AwsS3ObjectStorage, ObjectStorage, ObjectStorageError};

const RENDER_TIMEOUT: Duration = Duration::from_secs(10);
const NETWORK_IDLE_TIMEOUT: Duration = Duration::from_secs(5);
const NETWORK_IDLE_WINDOW: Duration = Duration::from_millis(500);
const GRANT_LIFETIME_SECONDS: i64 = 30;
const WAIT_FOR_ARTIFACT_READY_SCRIPT: &str = r"(async () => {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.documentElement.appendChild(style);
  const startedAt = performance.now();
  await Promise.race([
    document.fonts.ready,
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);
  let lastActivityAt = startedAt;
  const observer = new MutationObserver(() => {
    lastActivityAt = performance.now();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });
  await new Promise(resolve => {
    const interval = setInterval(() => {
      const now = performance.now();
      const imagesReady = Array.from(document.images).every(image => image.complete);
      const pageStable = now - startedAt >= 2000
        && now - lastActivityAt >= 500
        && imagesReady;
      if (pageStable || now - startedAt >= 3000) {
        clearInterval(interval);
        observer.disconnect();
        resolve();
      }
    }, 100);
  });
})()";
const FINALIZE_ARTIFACT_RENDER_SCRIPT: &str = r"(async () => {
  await Promise.all(
    Array.from(document.images)
      .filter(image => image.complete && image.naturalWidth > 0)
      .map(image => image.decode().catch(() => {}))
  );
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()";

#[derive(Clone, Debug)]
pub struct ThumbnailConfig {
    pub worker_id: String,
    pub internal_api_origin: String,
    pub chromium_path: PathBuf,
    pub lease_duration: Duration,
    pub poll_interval: Duration,
}

#[derive(Clone, Debug)]
struct ClaimedThumbnail {
    job_id: String,
    attempt_id: String,
    bundle_id: String,
    owner_user_id: String,
    renderer_revision: String,
    version_id: String,
    attempt_count: i32,
    max_attempts: i32,
    grant: String,
}

#[derive(Debug, Error)]
pub enum ThumbnailError {
    #[error("thumbnail database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("thumbnail browser failed: {0}")]
    Browser(String),
    #[error("thumbnail image conversion failed: {0}")]
    Image(String),
    #[error(transparent)]
    Storage(#[from] ObjectStorageError),
    #[error("thumbnail lease was lost")]
    LeaseLost,
}

pub async fn run_thumbnail_loop(
    pool: PgPool,
    storage: AwsS3ObjectStorage,
    config: ThumbnailConfig,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            return;
        }
        if let Err(error) = recover_expired(&pool).await {
            tracing::error!(event_name = "shareslices.artifact.thumbnail.lease_recovery_failed", error = %error);
        }
        match claim_next(&pool, &config).await {
            Ok(Some(claim)) => {
                let result = process_with_heartbeat(&pool, &storage, &config, &claim).await;
                if let Err(error) = result {
                    let transient = matches!(
                        error,
                        ThumbnailError::Database(_)
                            | ThumbnailError::Storage(_)
                            | ThumbnailError::Browser(_)
                    );
                    if let Err(record_error) =
                        fail_claim(&pool, &config.worker_id, &claim, &error, transient).await
                    {
                        tracing::error!(event_name = "shareslices.artifact.thumbnail.failure_transition_failed", error = %record_error);
                    }
                }
            }
            Ok(None) => {
                tokio::select! {
                    () = tokio::time::sleep(config.poll_interval) => {}
                    result = shutdown.changed() => if result.is_err() || *shutdown.borrow() { return; }
                }
            }
            Err(error) => {
                tracing::error!(event_name = "shareslices.artifact.thumbnail.claim_failed", error = %error);
                tokio::time::sleep(config.poll_interval).await;
            }
        }
    }
}

/// Requeues terminal thumbnail jobs that failed because Chromium was
/// unavailable and still have no stored thumbnail.
///
/// # Errors
///
/// Returns an error when the database update fails.
pub async fn requeue_failed_browser_jobs(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r"
        update content_bundle_thumbnail_job as job
        set state = 'queued',
            available_at = now(),
            attempt_count = 0,
            lease_owner = null,
            lease_expires_at = null,
            heartbeat_at = null,
            failure_reason_code = null,
            updated_at = now()
        where job.state = 'failed'
          and job.failure_reason_code = 'thumbnail_browser_failed'
          and not exists (
            select 1 from content_bundle_thumbnail as thumbnail
            where thumbnail.bundle_id = job.bundle_id
              and thumbnail.renderer_revision = job.renderer_revision
          )
        ",
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

async fn claim_next(
    pool: &PgPool,
    config: &ThumbnailConfig,
) -> Result<Option<ClaimedThumbnail>, ThumbnailError> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query(
        r"
        select id, bundle_id, owner_user_id, renderer_revision, attempt_count, max_attempts
        from content_bundle_thumbnail_job
        where state = 'queued' and available_at <= now()
        order by available_at, created_at, id
        for update skip locked
        limit 1
        ",
    )
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(row) = row else {
        transaction.commit().await?;
        return Ok(None);
    };
    let job_id: String = row.try_get("id")?;
    let bundle_id: String = row.try_get("bundle_id")?;
    let owner_user_id: String = row.try_get("owner_user_id")?;
    let renderer_revision: String = row.try_get("renderer_revision")?;
    let version_id = find_capture_version(
        &mut transaction,
        &bundle_id,
        &owner_user_id,
        &renderer_revision,
    )
    .await?;
    let Some(version_id) = version_id else {
        sqlx::query(
            "update content_bundle_thumbnail_job set state = 'cancelled', failure_reason_code = 'thumbnail_no_live_version', updated_at = now() where id = $1 and state = 'queued'",
        )
        .bind(&job_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        return Ok(None);
    };
    let attempt_count: i32 = row.try_get::<i32, _>("attempt_count")? + 1;
    let max_attempts: i32 = row.try_get("max_attempts")?;
    let lease_seconds = i64::try_from(config.lease_duration.as_secs()).unwrap_or(i64::MAX);
    sqlx::query(
        "update content_bundle_thumbnail_job set state = 'running', lease_owner = $2, lease_expires_at = now() + make_interval(secs => $3), heartbeat_at = now(), attempt_count = $4, updated_at = now() where id = $1"
    ).bind(&job_id).bind(&config.worker_id).bind(lease_seconds).bind(attempt_count).execute(&mut *transaction).await?;
    let attempt_id = Uuid::new_v4().to_string();
    let attempt_number: i32 = sqlx::query_scalar(
        "select coalesce(max(attempt_number), 0) + 1 from content_bundle_thumbnail_attempt where job_id = $1",
    )
    .bind(&job_id)
    .fetch_one(&mut *transaction)
    .await?;
    let object_key =
        format!("content-bundles/{bundle_id}/thumbnails/{renderer_revision}/{attempt_id}.webp");
    sqlx::query(
        r"
        insert into content_bundle_thumbnail_attempt (
          id, job_id, attempt_number, capture_version_id, object_key,
          lease_expires_at, write_deadline_at
        ) values (
          $1, $2, $3, $4, $5,
          now() + make_interval(secs => $6),
          now() + make_interval(secs => $6)
        )
        ",
    )
    .bind(&attempt_id)
    .bind(&job_id)
    .bind(attempt_number)
    .bind(&version_id)
    .bind(&object_key)
    .bind(lease_seconds)
    .execute(&mut *transaction)
    .await?;
    let grant = Uuid::new_v4().to_string();
    let token_hash = hex_sha256(grant.as_bytes());
    sqlx::query(
        "insert into artifact_thumbnail_capture_grant (token_hash, version_id, expires_at) values ($1, $2, now() + make_interval(secs => $3))"
    ).bind(token_hash).bind(&version_id).bind(GRANT_LIFETIME_SECONDS).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Some(ClaimedThumbnail {
        job_id,
        attempt_id,
        bundle_id,
        owner_user_id,
        renderer_revision,
        version_id,
        attempt_count,
        max_attempts,
        grant,
    }))
}

async fn find_capture_version(
    transaction: &mut Transaction<'_, Postgres>,
    bundle_id: &str,
    owner_user_id: &str,
    renderer_revision: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        r"
        select id
        from artifact_version
        where content_bundle_id = $1 and owner_user_id = $2
          and renderer_revision = $3 and state = 'ready'
        order by ready_at, id
        limit 1
        ",
    )
    .bind(bundle_id)
    .bind(owner_user_id)
    .bind(renderer_revision)
    .fetch_optional(&mut **transaction)
    .await
}

async fn process_claim(
    pool: &PgPool,
    storage: &AwsS3ObjectStorage,
    config: &ThumbnailConfig,
    claim: &ClaimedThumbnail,
) -> Result<(), ThumbnailError> {
    let url = format!(
        "{}/internal/thumbnail-captures/{}/content/?grant={}",
        config.internal_api_origin.trim_end_matches('/'),
        claim.version_id,
        claim.grant
    );
    let chromium_path = config.chromium_path.clone();
    let webp = tokio::task::spawn_blocking(move || render_thumbnail(&chromium_path, &url))
        .await
        .map_err(|error| ThumbnailError::Browser(error.to_string()))??;
    ensure_active_claim(pool, config, claim).await?;
    let object_key = format!(
        "content-bundles/{}/thumbnails/{}/{}.webp",
        claim.bundle_id, claim.renderer_revision, claim.attempt_id
    );
    let mut temporary =
        NamedTempFile::new().map_err(|error| ThumbnailError::Image(error.to_string()))?;
    std::io::Write::write_all(&mut temporary, &webp)
        .map_err(|error| ThumbnailError::Image(error.to_string()))?;
    let file = tokio::fs::File::open(temporary.path())
        .await
        .map_err(|error| ThumbnailError::Image(error.to_string()))?;
    storage
        .write_staging_object(&object_key, webp.len() as u64, "image/webp", Box::pin(file))
        .await?;
    complete_claim(
        pool,
        config,
        claim,
        i64::try_from(webp.len()).unwrap_or(i64::MAX),
        &hex_sha256(&webp),
    )
    .await
}

async fn ensure_active_claim(
    pool: &PgPool,
    config: &ThumbnailConfig,
    claim: &ClaimedThumbnail,
) -> Result<(), ThumbnailError> {
    let active: bool = sqlx::query_scalar(
        r"
        select exists (
          select 1
          from content_bundle_thumbnail_job job
          join content_bundle_thumbnail_attempt attempt on attempt.job_id = job.id
          where job.id = $1 and job.lease_owner = $2 and job.state = 'running'
            and job.lease_expires_at > now()
            and attempt.id = $3 and attempt.state = 'running'
            and attempt.lease_expires_at > now() and attempt.write_deadline_at > now()
        )
        ",
    )
    .bind(&claim.job_id)
    .bind(&config.worker_id)
    .bind(&claim.attempt_id)
    .fetch_one(pool)
    .await?;
    if active {
        Ok(())
    } else {
        Err(ThumbnailError::LeaseLost)
    }
}

async fn complete_claim(
    pool: &PgPool,
    config: &ThumbnailConfig,
    claim: &ClaimedThumbnail,
    size_bytes: i64,
    sha256: &str,
) -> Result<(), ThumbnailError> {
    let mut transaction = pool.begin().await?;
    let attempt = sqlx::query(
        r"
        update content_bundle_thumbnail_attempt
        set state = 'succeeded', finished_at = now()
        where id = $1 and job_id = $2 and state = 'running'
          and lease_expires_at > now() and write_deadline_at > now()
        returning id
        ",
    )
    .bind(&claim.attempt_id)
    .bind(&claim.job_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let completed = sqlx::query(
        r"
        update content_bundle_thumbnail_job
        set state = 'completed', lease_owner = null, lease_expires_at = null,
            heartbeat_at = null, failure_reason_code = null, updated_at = now()
        where id = $1 and lease_owner = $2 and state = 'running'
          and lease_expires_at > now()
        returning id
        ",
    )
    .bind(&claim.job_id)
    .bind(&config.worker_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if attempt.is_none() || completed.is_none() {
        transaction.rollback().await?;
        mark_attempt_for_cleanup(pool, &claim.attempt_id).await?;
        return Err(ThumbnailError::LeaseLost);
    }
    sqlx::query(
        r"
        insert into content_bundle_thumbnail (
          bundle_id, owner_user_id, renderer_revision, winning_attempt_id,
          object_key, content_type, size_bytes, width, height, sha256
        ) values ($1, $2, $3, $4, $5, 'image/webp', $6, 800, 450, $7)
        ",
    )
    .bind(&claim.bundle_id)
    .bind(&claim.owner_user_id)
    .bind(&claim.renderer_revision)
    .bind(&claim.attempt_id)
    .bind(format!(
        "content-bundles/{}/thumbnails/{}/{}.webp",
        claim.bundle_id, claim.renderer_revision, claim.attempt_id
    ))
    .bind(size_bytes)
    .bind(sha256)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

async fn mark_attempt_for_cleanup(pool: &PgPool, attempt_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r"
        update content_bundle_thumbnail_attempt
        set state = 'cancelled', finished_at = now(), cleanup_state = 'eligible',
            cleanup_eligible_at = now()
        where id = $1 and state = 'running'
        ",
    )
    .bind(attempt_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn process_with_heartbeat(
    pool: &PgPool,
    storage: &AwsS3ObjectStorage,
    config: &ThumbnailConfig,
    claim: &ClaimedThumbnail,
) -> Result<(), ThumbnailError> {
    let processing = process_claim(pool, storage, config, claim);
    tokio::pin!(processing);
    let heartbeat_interval = (config.lease_duration / 3).max(Duration::from_secs(1));
    let mut heartbeat = tokio::time::interval_at(
        tokio::time::Instant::now() + heartbeat_interval,
        heartbeat_interval,
    );
    loop {
        tokio::select! {
            result = &mut processing => return result,
            _ = heartbeat.tick() => {
                let lease_seconds = i64::try_from(config.lease_duration.as_secs()).unwrap_or(i64::MAX);
                let mut transaction = pool.begin().await?;
                let renewed = sqlx::query(
                    "update content_bundle_thumbnail_job set lease_expires_at = now() + make_interval(secs => $3), heartbeat_at = now(), updated_at = now() where id = $1 and lease_owner = $2 and state = 'running' and lease_expires_at > now() returning id"
                ).bind(&claim.job_id).bind(&config.worker_id).bind(lease_seconds).fetch_optional(&mut *transaction).await?;
                let attempt_renewed = sqlx::query(
                    "update content_bundle_thumbnail_attempt set lease_expires_at = now() + make_interval(secs => $2) where id = $1 and state = 'running' and lease_expires_at > now() returning id"
                ).bind(&claim.attempt_id).bind(lease_seconds).fetch_optional(&mut *transaction).await?;
                if renewed.is_none() || attempt_renewed.is_none() {
                    transaction.rollback().await?;
                    mark_attempt_for_cleanup(pool, &claim.attempt_id).await?;
                    return Err(ThumbnailError::LeaseLost);
                }
                transaction.commit().await?;
            }
        }
    }
}

/// Renders the target page to the Artifact card's WebP thumbnail format.
///
/// # Errors
///
/// Returns an error when the target URL is invalid, Chromium cannot render the
/// page, or the captured PNG cannot be converted to WebP.
pub fn render_thumbnail(chromium_path: &Path, target_url: &str) -> Result<Vec<u8>, ThumbnailError> {
    let origin =
        Url::parse(target_url).map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let allowed_origin = origin.origin().ascii_serialization();
    let allowed_path_prefix = origin.path().to_owned();
    let reduced_motion = std::ffi::OsStr::new("--force-prefers-reduced-motion");
    let options = LaunchOptionsBuilder::default()
        .path(Some(chromium_path.to_path_buf()))
        .headless(true)
        // Chromium's namespace sandbox is unavailable under the default container
        // seccomp profile. Isolation is provided by the non-root Worker container,
        // no privilege escalation, request interception, and the manifest-only route.
        .sandbox(false)
        .window_size(Some((1440, 810)))
        .args(vec![reduced_motion])
        .idle_browser_timeout(RENDER_TIMEOUT)
        .build()
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let browser =
        Browser::new(options).map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let tab = browser
        .new_tab()
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let network_activity = observe_network_activity(&tab)?;
    tab.set_default_timeout(RENDER_TIMEOUT);
    tab.enable_fetch(
        Some(&[RequestPattern {
            url_pattern: None,
            resource_Type: None,
            request_stage: Some(RequestStage::Request),
        }]),
        None,
    )
    .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    tab.enable_request_interception(Arc::new(
        move |_transport, _session, event: RequestPausedEvent| {
            let permitted = Url::parse(&event.params.request.url).is_ok_and(|url| {
                url.origin().ascii_serialization() == allowed_origin
                    && url.path().starts_with(&allowed_path_prefix)
            });
            if permitted {
                RequestPausedDecision::Continue(None)
            } else {
                RequestPausedDecision::Fulfill(FulfillRequest {
                    request_id: event.params.request_id,
                    response_code: 403,
                    response_headers: None,
                    binary_response_headers: None,
                    body: None,
                    response_phrase: Some("Blocked by ShareSlices thumbnail isolation".to_owned()),
                })
            }
        },
    ))
    .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    tab.navigate_to(target_url)
        .and_then(|tab| tab.wait_until_navigated())
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    wait_for_network_idle(&network_activity);
    tab.evaluate(WAIT_FOR_ARTIFACT_READY_SCRIPT, true)
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    wait_for_network_idle(&network_activity);
    tab.evaluate(FINALIZE_ARTIFACT_RENDER_SCRIPT, true)
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let png = tab
        .capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let image = image::load_from_memory_with_format(&png, ImageFormat::Png)
        .map_err(|error| ThumbnailError::Image(error.to_string()))?
        .resize_exact(800, 450, FilterType::Lanczos3);
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|error| ThumbnailError::Image(error.to_string()))?;
    Ok(output.into_inner())
}

struct NetworkActivity {
    pending: HashSet<String>,
    last_change: Instant,
}

impl NetworkActivity {
    fn new() -> Self {
        Self {
            pending: HashSet::new(),
            last_change: Instant::now(),
        }
    }
}

fn observe_network_activity(tab: &Tab) -> Result<Arc<Mutex<NetworkActivity>>, ThumbnailError> {
    let activity = Arc::new(Mutex::new(NetworkActivity::new()));
    let listener_activity = Arc::clone(&activity);
    tab.call_method(Network::Enable {
        max_total_buffer_size: None,
        max_resource_buffer_size: None,
        max_post_data_size: None,
        report_direct_socket_traffic: None,
        enable_durable_messages: None,
    })
    .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    tab.add_event_listener(Arc::new(move |event: &Event| {
        let mut activity = listener_activity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match event {
            Event::NetworkRequestWillBeSent(event) => {
                activity.pending.insert(event.params.request_id.clone());
            }
            Event::NetworkLoadingFinished(event) => {
                activity.pending.remove(&event.params.request_id);
            }
            Event::NetworkLoadingFailed(event) => {
                activity.pending.remove(&event.params.request_id);
            }
            _ => return,
        }
        activity.last_change = Instant::now();
    }))
    .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    Ok(activity)
}

fn wait_for_network_idle(activity: &Mutex<NetworkActivity>) {
    let deadline = Instant::now() + NETWORK_IDLE_TIMEOUT;
    loop {
        {
            let activity = activity
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if activity.pending.is_empty() && activity.last_change.elapsed() >= NETWORK_IDLE_WINDOW
            {
                return;
            }
        }
        if Instant::now() >= deadline {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// Verifies that Chromium can launch, render HTML, capture a screenshot, and
/// complete the image conversion used by thumbnail jobs.
///
/// # Errors
///
/// Returns an error when the local preflight page cannot be served or Chromium
/// cannot complete the production thumbnail pipeline.
pub fn preflight_chromium(chromium_path: &Path) -> Result<(), ThumbnailError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let address = listener
        .local_addr()
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let stopped = Arc::new(AtomicBool::new(false));
    let server_stopped = Arc::clone(&stopped);
    let server = thread::spawn(move || {
        while !server_stopped.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let body = "<!doctype html><title>Worker preflight</title><main>ready</main>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => return,
            }
        }
    });

    let result = render_thumbnail(chromium_path, &format!("http://{address}/preflight/"));
    stopped.store(true, Ordering::Relaxed);
    server
        .join()
        .map_err(|_| ThumbnailError::Browser("Chromium preflight server panicked".to_owned()))?;
    result.map(|_| ())
}

async fn fail_claim(
    pool: &PgPool,
    worker_id: &str,
    claim: &ClaimedThumbnail,
    error: &ThumbnailError,
    transient: bool,
) -> Result<(), sqlx::Error> {
    let retry = should_retry(transient, claim.attempt_count, claim.max_attempts);
    let state = if retry { "queued" } else { "failed" };
    let reason = match error {
        ThumbnailError::Storage(_) => "thumbnail_storage_unavailable",
        ThumbnailError::Database(_) => "thumbnail_database_unavailable",
        ThumbnailError::Browser(_) => "thumbnail_browser_failed",
        ThumbnailError::Image(_) => "thumbnail_image_invalid",
        ThumbnailError::LeaseLost => "thumbnail_lease_lost",
    };
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "update content_bundle_thumbnail_attempt set state = 'failed', finished_at = now(), cleanup_state = 'eligible', cleanup_eligible_at = now() where id = $1 and state = 'running'"
    ).bind(&claim.attempt_id).execute(&mut *transaction).await?;
    sqlx::query(
        "update content_bundle_thumbnail_job set state = $3, available_at = case when $4 then now() + make_interval(secs => 5 * attempt_count) else available_at end, lease_owner = null, lease_expires_at = null, heartbeat_at = null, failure_reason_code = $5, updated_at = now() where id = $1 and lease_owner = $2 and state = 'running'"
    ).bind(&claim.job_id).bind(worker_id).bind(state).bind(retry).bind(reason).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(())
}

async fn recover_expired(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r"
        update content_bundle_thumbnail_attempt attempt
        set state = 'failed', finished_at = now(), cleanup_state = 'eligible',
            cleanup_eligible_at = now()
        from content_bundle_thumbnail_job job
        where attempt.job_id = job.id and attempt.state = 'running'
          and job.state = 'running' and job.lease_expires_at <= now()
        ",
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "update content_bundle_thumbnail_job set state = case when attempt_count < max_attempts then 'queued' else 'failed' end, available_at = now(), lease_owner = null, lease_expires_at = null, heartbeat_at = null, failure_reason_code = 'thumbnail_lease_expired', updated_at = now() where state = 'running' and lease_expires_at <= now()"
    ).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(())
}

fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

const fn should_retry(transient: bool, attempt_count: i32, max_attempts: i32) -> bool {
    transient && attempt_count < max_attempts
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::Path, time::Duration};

    use sqlx::{PgPool, postgres::PgPoolOptions};
    use uuid::Uuid;

    use super::{
        ThumbnailConfig, ThumbnailError, claim_next, complete_claim, fail_claim,
        preflight_chromium, should_retry,
    };

    #[test]
    fn retries_only_transient_failures_before_the_third_attempt() {
        assert!(should_retry(true, 1, 3));
        assert!(should_retry(true, 2, 3));
        assert!(!should_retry(true, 3, 3));
        assert!(!should_retry(false, 1, 3));
    }

    #[test]
    fn preflight_rejects_a_missing_chromium_binary() {
        assert!(matches!(
            preflight_chromium(Path::new("/missing/shareslices-chromium")),
            Err(ThumbnailError::Browser(_))
        ));
    }

    #[tokio::test]
    async fn bundle_claim_selects_a_live_version_and_publishes_attempt_unique_metadata() {
        let Some(database) = TestDatabase::create().await else {
            return;
        };
        database.seed_bundle_job().await;
        sqlx::query("delete from artifact_version where id = 'version-a'")
            .execute(&database.pool)
            .await
            .expect("delete first capture Version");

        let config = config("thumbnail-worker");
        let claim = claim_next(&database.pool, &config)
            .await
            .expect("claim query")
            .expect("claim");
        assert_eq!(claim.version_id, "version-b");
        assert_eq!(claim.bundle_id, "bundle-1");
        let attempt: (String, String) = sqlx::query_as(
            "select capture_version_id, object_key from content_bundle_thumbnail_attempt where id = $1",
        )
        .bind(&claim.attempt_id)
        .fetch_one(&database.pool)
        .await
        .expect("attempt");
        assert_eq!(attempt.0, "version-b");
        assert!(attempt.1.ends_with(&format!("/{}.webp", claim.attempt_id)));

        complete_claim(&database.pool, &config, &claim, 123, &"a".repeat(64))
            .await
            .expect("publish thumbnail metadata");
        let winner: (String, String) = sqlx::query_as(
            "select winning_attempt_id, object_key from content_bundle_thumbnail where bundle_id = 'bundle-1' and renderer_revision = 'renderer-v2'",
        )
        .fetch_one(&database.pool)
        .await
        .expect("winner metadata");
        assert_eq!(winner.0, claim.attempt_id);
        assert_eq!(winner.1, attempt.1);

        database.drop().await;
    }

    #[tokio::test]
    async fn stale_thumbnail_attempt_cannot_publish_winner_metadata() {
        let Some(database) = TestDatabase::create().await else {
            return;
        };
        database.seed_bundle_job().await;
        let config = config("thumbnail-worker");
        let claim = claim_next(&database.pool, &config)
            .await
            .expect("claim query")
            .expect("claim");
        sqlx::query(
            "update content_bundle_thumbnail_job set lease_expires_at = now() - interval '1 second' where id = $1",
        )
        .bind(&claim.job_id)
        .execute(&database.pool)
        .await
        .expect("expire lease");

        assert!(matches!(
            complete_claim(&database.pool, &config, &claim, 123, &"a".repeat(64)).await,
            Err(ThumbnailError::LeaseLost)
        ));
        let attempt: (String, String) = sqlx::query_as(
            "select state, cleanup_state from content_bundle_thumbnail_attempt where id = $1",
        )
        .bind(&claim.attempt_id)
        .fetch_one(&database.pool)
        .await
        .expect("stale attempt");
        assert_eq!(attempt, ("cancelled".to_owned(), "eligible".to_owned()));
        let thumbnail_count: i64 =
            sqlx::query_scalar("select count(*) from content_bundle_thumbnail")
                .fetch_one(&database.pool)
                .await
                .expect("thumbnail count");
        assert_eq!(thumbnail_count, 0);

        database.drop().await;
    }

    #[tokio::test]
    async fn retry_selects_another_live_version_after_capture_version_deletion() {
        let Some(database) = TestDatabase::create().await else {
            return;
        };
        database.seed_bundle_job().await;
        let config = config("thumbnail-worker");
        let first = claim_next(&database.pool, &config)
            .await
            .expect("first claim query")
            .expect("first claim");
        assert_eq!(first.version_id, "version-a");
        sqlx::query("delete from artifact_version where id = 'version-a'")
            .execute(&database.pool)
            .await
            .expect("delete capture Version");
        fail_claim(
            &database.pool,
            &config.worker_id,
            &first,
            &ThumbnailError::Browser("capture Version disappeared".to_owned()),
            true,
        )
        .await
        .expect("retry first claim");
        sqlx::query(
            "update content_bundle_thumbnail_job set available_at = now() where id = 'thumbnail-job'",
        )
        .execute(&database.pool)
        .await
        .expect("make retry available");

        let second = claim_next(&database.pool, &config)
            .await
            .expect("second claim query")
            .expect("second claim");
        assert_eq!(second.version_id, "version-b");
        assert_ne!(second.attempt_id, first.attempt_id);
        let object_keys: Vec<String> = sqlx::query_scalar(
            "select object_key from content_bundle_thumbnail_attempt order by attempt_number",
        )
        .fetch_all(&database.pool)
        .await
        .expect("attempt object keys");
        assert_eq!(object_keys.len(), 2);
        assert_ne!(object_keys[0], object_keys[1]);

        database.drop().await;
    }

    #[tokio::test]
    async fn invalid_thumbnail_digest_cannot_publish_metadata() {
        let Some(database) = TestDatabase::create().await else {
            return;
        };
        database.seed_bundle_job().await;
        let config = config("thumbnail-worker");
        let claim = claim_next(&database.pool, &config)
            .await
            .expect("claim query")
            .expect("claim");

        assert!(matches!(
            complete_claim(&database.pool, &config, &claim, 123, "invalid").await,
            Err(ThumbnailError::Database(_))
        ));
        let thumbnail_count: i64 =
            sqlx::query_scalar("select count(*) from content_bundle_thumbnail")
                .fetch_one(&database.pool)
                .await
                .expect("thumbnail count");
        assert_eq!(thumbnail_count, 0);

        database.drop().await;
    }

    fn config(worker_id: &str) -> ThumbnailConfig {
        ThumbnailConfig {
            worker_id: worker_id.to_owned(),
            internal_api_origin: "http://127.0.0.1:7456".to_owned(),
            chromium_path: "/missing/chromium".into(),
            lease_duration: Duration::from_secs(30),
            poll_interval: Duration::from_millis(10),
        }
    }

    struct TestDatabase {
        admin: PgPool,
        pool: PgPool,
        schema: String,
    }

    impl TestDatabase {
        async fn create() -> Option<Self> {
            let Ok(database_url) = env::var("DATABASE_URL") else {
                eprintln!("skipping PostgreSQL integration test: DATABASE_URL is not set");
                return None;
            };
            let admin = PgPoolOptions::new()
                .max_connections(2)
                .connect(&database_url)
                .await
                .expect("connect to PostgreSQL");
            let schema = format!("thumbnail_test_{}", Uuid::new_v4().simple());
            sqlx::query(&format!("create schema \"{schema}\""))
                .execute(&admin)
                .await
                .expect("create schema");
            let search_path = schema.clone();
            let pool = PgPoolOptions::new()
                .max_connections(4)
                .after_connect(move |connection, _| {
                    let statement = format!("set search_path to \"{search_path}\"");
                    Box::pin(async move {
                        sqlx::query(&statement).execute(connection).await?;
                        Ok(())
                    })
                })
                .connect(&database_url)
                .await
                .expect("connect to schema");
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repository root");
            for migration in [
                "db/migrations/0001_account_entry.sql",
                "db/migrations/0002_artifact_foundation.sql",
                "db/migrations/0003_artifact_validation_report.sql",
                "db/migrations/0010_artifact_thumbnail.sql",
                "db/migrations/0012_content_bundle_foundation.sql",
                "db/migrations/0013_artifact_thumbnail_16_9.sql",
            ] {
                let sql = fs::read_to_string(root.join(migration)).expect("read migration");
                sqlx::raw_sql(&sql)
                    .execute(&pool)
                    .await
                    .expect("apply migration");
            }
            Some(Self {
                admin,
                pool,
                schema,
            })
        }

        async fn seed_bundle_job(&self) {
            sqlx::raw_sql(
                r#"
                insert into "user" (id, name, email) values ('owner-1', 'Owner', 'owner@example.com');
                insert into artifact (id, owner_user_id, name) values
                  ('artifact-a', 'owner-1', 'Artifact A'),
                  ('artifact-b', 'owner-1', 'Artifact B');
                insert into artifact_upload_session (
                  id, artifact_id, owner_user_id, policy_revision, archive_size_bytes,
                  expanded_size_bytes, file_count, single_file_size_bytes, formats,
                  raw_object_key, raw_size_bytes, state
                ) values
                  ('upload-a', 'artifact-a', 'owner-1', 'policy-v1', 100, 100, 10, 100, '[]', 'raw/a.zip', 10, 'committed'),
                  ('upload-b', 'artifact-b', 'owner-1', 'policy-v1', 100, 100, 10, 100, '[]', 'raw/b.zip', 10, 'committed');
                insert into artifact_processing_job (id, upload_session_id, state, max_attempts)
                  values ('processing-job', 'upload-a', 'completed', 3);
                insert into artifact_processing_attempt (
                  id, owner_user_id, job_id, attempt_number, state, staging_prefix, finished_at
                ) values ('processing-attempt', 'owner-1', 'processing-job', 1, 'succeeded', 'staging/a/', now());
                insert into content_bundle (
                  id, owner_user_id, content_identity_revision, lifecycle_state, integrity_state,
                  creator_attempt_id, winning_attempt_id, ready_at
                ) values ('bundle-1', 'owner-1', 'content-v1', 'ready', 'healthy',
                  'processing-attempt', 'processing-attempt', now());
                insert into artifact_version (
                  id, artifact_id, upload_session_id, version_number, state, owner_user_id,
                  content_bundle_id, renderer_revision
                ) values
                  ('version-a', 'artifact-a', 'upload-a', 1, 'ready', 'owner-1', 'bundle-1', 'renderer-v2'),
                  ('version-b', 'artifact-b', 'upload-b', 1, 'ready', 'owner-1', 'bundle-1', 'renderer-v2');
                insert into content_bundle_thumbnail_job (
                  id, bundle_id, owner_user_id, renderer_revision
                ) values ('thumbnail-job', 'bundle-1', 'owner-1', 'renderer-v2');
                "#,
            )
            .execute(&self.pool)
            .await
            .expect("seed thumbnail job");
        }

        async fn drop(self) {
            self.pool.close().await;
            sqlx::query(&format!("drop schema \"{}\" cascade", self.schema))
                .execute(&self.admin)
                .await
                .expect("drop schema");
            self.admin.close().await;
        }
    }
}
