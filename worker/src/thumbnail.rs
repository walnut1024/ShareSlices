use std::{
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use headless_chrome::protocol::cdp::{
    Fetch::{FulfillRequest, RequestPattern, RequestStage, events::RequestPausedEvent},
    Page::CaptureScreenshotFormatOption,
};
use headless_chrome::{Browser, LaunchOptionsBuilder, browser::tab::RequestPausedDecision};
use image::{ImageFormat, imageops::FilterType};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use tempfile::NamedTempFile;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::object_storage::{AwsS3ObjectStorage, ObjectStorage, ObjectStorageError};

const RENDER_TIMEOUT: Duration = Duration::from_secs(10);
const GRANT_LIFETIME_SECONDS: i64 = 30;

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
    version_id: String,
    attempt_count: i32,
    max_attempts: i32,
    grant: String,
}

#[derive(Debug, Error)]
pub enum ThumbnailError {
    #[error("thumbnail database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("thumbnail render timed out")]
    RenderTimeout,
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

async fn claim_next(
    pool: &PgPool,
    config: &ThumbnailConfig,
) -> Result<Option<ClaimedThumbnail>, ThumbnailError> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query(
        r"
        select id, version_id, attempt_count, max_attempts
        from artifact_thumbnail_job
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
    let version_id: String = row.try_get("version_id")?;
    let attempt_count: i32 = row.try_get::<i32, _>("attempt_count")? + 1;
    let max_attempts: i32 = row.try_get("max_attempts")?;
    let lease_seconds = i64::try_from(config.lease_duration.as_secs()).unwrap_or(i64::MAX);
    sqlx::query(
        "update artifact_thumbnail_job set state = 'running', lease_owner = $2, lease_expires_at = now() + make_interval(secs => $3), heartbeat_at = now(), attempt_count = $4, updated_at = now() where id = $1"
    ).bind(&job_id).bind(&config.worker_id).bind(lease_seconds).bind(attempt_count).execute(&mut *transaction).await?;
    let grant = Uuid::new_v4().to_string();
    let token_hash = hex_sha256(grant.as_bytes());
    sqlx::query(
        "insert into artifact_thumbnail_capture_grant (token_hash, version_id, expires_at) values ($1, $2, now() + make_interval(secs => $3))"
    ).bind(token_hash).bind(&version_id).bind(GRANT_LIFETIME_SECONDS).execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(Some(ClaimedThumbnail {
        job_id,
        version_id,
        attempt_count,
        max_attempts,
        grant,
    }))
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
    let webp = tokio::time::timeout(
        RENDER_TIMEOUT,
        tokio::task::spawn_blocking(move || render_thumbnail(&chromium_path, &url)),
    )
    .await
    .map_err(|_| ThumbnailError::RenderTimeout)?
    .map_err(|error| ThumbnailError::Browser(error.to_string()))??;
    let object_key = format!("versions/{}/thumbnail.webp", claim.version_id);
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
    let mut transaction = pool.begin().await?;
    let completed = sqlx::query(
        "update artifact_thumbnail_job set state = 'completed', lease_owner = null, lease_expires_at = null, heartbeat_at = null, failure_reason_code = null, updated_at = now() where id = $1 and lease_owner = $2 and state = 'running' returning id"
    ).bind(&claim.job_id).bind(&config.worker_id).fetch_optional(&mut *transaction).await?;
    if completed.is_none() {
        transaction.rollback().await?;
        return Err(ThumbnailError::LeaseLost);
    }
    sqlx::query(
        "insert into artifact_thumbnail (version_id, object_key, content_type, size_bytes, width, height, sha256) values ($1, $2, 'image/webp', $3, 480, 300, $4) on conflict (version_id) do nothing"
    ).bind(&claim.version_id).bind(&object_key).bind(i64::try_from(webp.len()).unwrap_or(i64::MAX))
      .bind(hex_sha256(&webp)).execute(&mut *transaction).await?;
    transaction.commit().await?;
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
                let renewed = sqlx::query(
                    "update artifact_thumbnail_job set lease_expires_at = now() + make_interval(secs => $3), heartbeat_at = now(), updated_at = now() where id = $1 and lease_owner = $2 and state = 'running' returning id"
                ).bind(&claim.job_id).bind(&config.worker_id).bind(lease_seconds).fetch_optional(pool).await?;
                if renewed.is_none() { return Err(ThumbnailError::LeaseLost); }
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
        .window_size(Some((1440, 900)))
        .args(vec![reduced_motion])
        .idle_browser_timeout(RENDER_TIMEOUT)
        .build()
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let browser =
        Browser::new(options).map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let tab = browser
        .new_tab()
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
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
    tab.evaluate(
        r"(async () => {
          const style = document.createElement('style');
          style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
          document.documentElement.appendChild(style);
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()",
        true,
    ).map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let png = tab
        .capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
        .map_err(|error| ThumbnailError::Browser(error.to_string()))?;
    let image = image::load_from_memory_with_format(&png, ImageFormat::Png)
        .map_err(|error| ThumbnailError::Image(error.to_string()))?
        .resize_exact(480, 300, FilterType::Lanczos3);
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|error| ThumbnailError::Image(error.to_string()))?;
    Ok(output.into_inner())
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
        ThumbnailError::RenderTimeout => "thumbnail_render_timeout",
        ThumbnailError::Storage(_) => "thumbnail_storage_unavailable",
        ThumbnailError::Database(_) => "thumbnail_database_unavailable",
        ThumbnailError::Browser(_) => "thumbnail_browser_failed",
        ThumbnailError::Image(_) => "thumbnail_image_invalid",
        ThumbnailError::LeaseLost => "thumbnail_lease_lost",
    };
    sqlx::query(
        "update artifact_thumbnail_job set state = $3, available_at = case when $4 then now() + make_interval(secs => 5 * attempt_count) else available_at end, lease_owner = null, lease_expires_at = null, heartbeat_at = null, failure_reason_code = $5, updated_at = now() where id = $1 and lease_owner = $2 and state = 'running'"
    ).bind(&claim.job_id).bind(worker_id).bind(state).bind(retry).bind(reason).execute(pool).await?;
    Ok(())
}

async fn recover_expired(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update artifact_thumbnail_job set state = case when attempt_count < max_attempts then 'queued' else 'failed' end, available_at = now(), lease_owner = null, lease_expires_at = null, heartbeat_at = null, failure_reason_code = 'thumbnail_lease_expired', updated_at = now() where state = 'running' and lease_expires_at <= now()"
    ).execute(pool).await?;
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
    use super::should_retry;

    #[test]
    fn retries_only_transient_failures_before_the_third_attempt() {
        assert!(should_retry(true, 1, 3));
        assert!(should_retry(true, 2, 3));
        assert!(!should_retry(true, 3, 3));
        assert!(!should_retry(false, 1, 3));
    }
}
