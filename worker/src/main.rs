// cspell:ignore oneshot subsec
mod config;
mod runtime;

use std::{sync::Arc, time::Duration};

use aws_sdk_s3::config::{Credentials, Region};
use config::WorkerConfig;
use runtime::{
    PostgresInputSource, ProductionRuntime, RuntimeConfig, StorageAttemptProcessor, WorkerRuntime,
};
use shareslices_worker::{
    content_fingerprint::{FingerprintError, FingerprintKey},
    health::{DEFAULT_READY_FILE, ReadyFile},
    job_store::{ContentBundleIntegrity, ContentBundleStore, PostgresJobStore},
    logging::{LogConfig, SanitizedException, Severity, WorkerEvent},
    manifest::ReadyManifest,
    object_storage::{AwsS3ObjectStorage, ObjectStorage},
    retry_policy::RetryPolicy,
    thumbnail::{
        ThumbnailConfig, preflight_chromium, requeue_failed_browser_jobs, run_thumbnail_loop,
    },
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

#[tokio::main]
async fn main() {
    let command = std::env::args().nth(1);
    if command.as_deref() == Some("healthcheck") {
        let chromium_path = std::env::var_os("CHROMIUM_PATH").map_or_else(
            || std::path::PathBuf::from("chromium"),
            std::path::PathBuf::from,
        );
        let ready_file = std::env::var_os("WORKER_READY_FILE").map_or_else(
            || std::path::PathBuf::from(DEFAULT_READY_FILE),
            std::path::PathBuf::from,
        );
        if let Err(error) = ReadyFile::new(ready_file).check(&chromium_path) {
            eprintln!("worker is not healthy: {error}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(command) = command.as_deref()
        && command != "requeue-failed-thumbnails"
    {
        eprintln!("unknown worker command: {command}");
        std::process::exit(2);
    }
    let config = match WorkerConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("invalid worker configuration: {error}");
            std::process::exit(2);
        }
    };
    if let Err(error) = shareslices_worker::logging::init(LogConfig::new(
        env!("CARGO_PKG_VERSION"),
        &config.deployment_environment,
    )) {
        eprintln!("failed to initialize worker logging: {error}");
        std::process::exit(2);
    }

    let result = if command.as_deref() == Some("requeue-failed-thumbnails") {
        requeue_failed_thumbnails(&config).await
    } else {
        run(config).await
    };
    if let Err(error) = result {
        WorkerEvent::new(
            Severity::Fatal,
            "shareslices.worker.startup_failed",
            "worker startup failed",
        )
        .with_exception(SanitizedException::new(
            "WorkerStartupError",
            error.to_string(),
            Option::<&str>::None,
            std::iter::empty::<&str>(),
        ))
        .emit();
        std::process::exit(1);
    }
}

async fn requeue_failed_thumbnails(
    config: &WorkerConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    preflight_chromium(&config.chromium_path)?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&config.database_url)
        .await?;
    let count = requeue_failed_browser_jobs(&pool).await?;
    tracing::info!(
        event_name = "shareslices.artifact.thumbnail.failed_jobs_requeued",
        shareslices.thumbnail.requeued_count = count,
        "failed thumbnail jobs requeued"
    );
    pool.close().await;
    Ok(())
}

async fn run(config: WorkerConfig) -> Result<(), Box<dyn std::error::Error>> {
    let ready_file = std::env::var_os("WORKER_READY_FILE").map_or_else(
        || std::path::PathBuf::from(DEFAULT_READY_FILE),
        std::path::PathBuf::from,
    );
    let readiness = ReadyFile::new(ready_file);
    readiness.clear()?;
    preflight_chromium(&config.chromium_path)?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    let storage = configured_storage(&config);
    let store = Arc::new(PostgresJobStore::new(pool.clone()));
    let (current_fingerprint_key, previous_fingerprint_key) = fingerprint_keys(&config)?;
    let runtime: ProductionRuntime = WorkerRuntime::new(
        Arc::clone(&store),
        processing_input_source(
            pool.clone(),
            &config,
            current_fingerprint_key.clone(),
            previous_fingerprint_key,
        ),
        StorageAttemptProcessor::new(storage.clone()),
        RetryPolicy::new(jitter),
        RuntimeConfig {
            worker_id: format!("worker-{}", Uuid::new_v4()),
            poll_interval: config.poll_interval,
            lease_duration: config.lease_duration,
            heartbeat_interval: config.heartbeat_interval,
            write_concurrency: config.write_concurrency,
            recovery_limit: config.recovery_limit,
            configured_max_attempts: config.job_max_attempts,
        },
    );
    let _ready_guard = readiness.mark_ready()?;

    WorkerEvent::new(
        Severity::Info,
        "shareslices.worker.started",
        "worker started",
    )
    .emit();
    let (shutdown_sender, shutdown_receiver) = tokio::sync::watch::channel(false);
    let alias_reindex_task = tokio::spawn(run_alias_reindex_loop(
        Arc::clone(&store),
        storage.clone(),
        current_fingerprint_key,
        shutdown_receiver.clone(),
    ));
    let (thumbnail_exit_sender, thumbnail_exit_receiver) = tokio::sync::oneshot::channel();
    let thumbnail_pool = pool.clone();
    let thumbnail_task = tokio::spawn(async move {
        run_thumbnail_loop(
            thumbnail_pool,
            storage,
            ThumbnailConfig {
                worker_id: format!("thumbnail-worker-{}", Uuid::new_v4()),
                internal_api_origin: config.thumbnail_internal_api_origin,
                chromium_path: config.chromium_path,
                lease_duration: config.lease_duration,
                poll_interval: config.poll_interval,
            },
            shutdown_receiver.clone(),
        )
        .await;
        let _ = thumbnail_exit_sender.send(());
    });
    let thumbnail_stopped_unexpectedly = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shutdown_reason = Arc::clone(&thumbnail_stopped_unexpectedly);
    runtime
        .run_until(async move {
            tokio::select! {
                biased;
                () = shutdown_signal() => {}
                _ = thumbnail_exit_receiver => {
                    shutdown_reason.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
            shutdown_sender.send_replace(true);
        })
        .await;
    thumbnail_task.await?;
    alias_reindex_task.await?;
    if thumbnail_stopped_unexpectedly.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("thumbnail loop stopped unexpectedly".into());
    }
    pool.close().await;
    Ok(())
}

fn processing_input_source(
    pool: PgPool,
    config: &WorkerConfig,
    current: FingerprintKey,
    previous: Option<FingerprintKey>,
) -> PostgresInputSource {
    PostgresInputSource::new(
        pool,
        config.lease_duration,
        config.content_identity_revision.clone(),
        current,
        previous,
        config.renderer_revision.clone(),
        config.processing_revision.clone(),
    )
}

fn configured_storage(config: &WorkerConfig) -> AwsS3ObjectStorage {
    let s3_config = aws_sdk_s3::Config::builder()
        .behavior_version_latest()
        .endpoint_url(&config.s3_endpoint)
        .region(Region::new(config.s3_region.clone()))
        .credentials_provider(Credentials::new(
            config.s3_access_key_id.clone(),
            config.s3_secret_access_key.clone(),
            None,
            None,
            "shareslices-worker",
        ))
        .force_path_style(config.s3_force_path_style)
        .build();
    AwsS3ObjectStorage::new(aws_sdk_s3::Client::from_conf(s3_config), &config.s3_bucket)
}

fn fingerprint_keys(
    config: &WorkerConfig,
) -> Result<(FingerprintKey, Option<FingerprintKey>), FingerprintError> {
    let current = FingerprintKey::new(
        config.content_fingerprint_key_current_revision.clone(),
        config.content_fingerprint_key_current.as_bytes().to_vec(),
    )?;
    let previous = config
        .content_fingerprint_key_previous_revision
        .as_ref()
        .zip(config.content_fingerprint_key_previous.as_ref())
        .map(|(revision, key)| FingerprintKey::new(revision.clone(), key.as_bytes().to_vec()))
        .transpose()?;
    Ok((current, previous))
}

async fn run_alias_reindex_loop(
    store: Arc<PostgresJobStore>,
    storage: AwsS3ObjectStorage,
    current_key: FingerprintKey,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        match reindex_bundle_aliases(&store, &storage, &current_key, 100).await {
            Ok(count) if count > 0 => tracing::info!(
                event_name = "shareslices.artifact.bundle_alias.reindexed",
                shareslices.bundle_alias.reindexed_count = count,
                "Content bundle aliases reindexed"
            ),
            Ok(_) => {}
            Err(error) => WorkerEvent::new(
                Severity::Error,
                "shareslices.artifact.bundle_alias.reindex_failed",
                "Content bundle alias reindex failed",
            )
            .with_exception(SanitizedException::new(
                std::any::type_name_of_val(&*error),
                error.to_string(),
                Option::<&str>::None,
                std::iter::empty::<&str>(),
            ))
            .emit(),
        }
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(30)) => {}
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    break;
                }
            }
        }
    }
}

async fn reindex_bundle_aliases(
    store: &PostgresJobStore,
    storage: &dyn ObjectStorage,
    current_key: &FingerprintKey,
    limit: i64,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
    let candidates = store
        .list_bundle_alias_reindex_candidates(&current_key.revision, limit)
        .await?;
    let mut installed = 0_u64;
    for candidate in candidates {
        let Some(manifest_object_key) = candidate.manifest_object_key.as_deref() else {
            store
                .quarantine_content_bundle(&candidate.bundle_id, ContentBundleIntegrity::Suspect)
                .await?;
            continue;
        };
        let mut bytes = Vec::new();
        storage
            .read_private_object(manifest_object_key)
            .await?
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)
            .await?;
        let manifest = if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_MANIFEST_BYTES {
            None
        } else {
            serde_json::from_slice::<ReadyManifest>(&bytes).ok()
        };
        let Some(manifest) = manifest else {
            store
                .quarantine_content_bundle(&candidate.bundle_id, ContentBundleIntegrity::Suspect)
                .await?;
            continue;
        };
        let Ok(identity) = manifest.content_identity(&candidate.content_identity_revision) else {
            store
                .quarantine_content_bundle(&candidate.bundle_id, ContentBundleIntegrity::Suspect)
                .await?;
            continue;
        };
        let alias = current_key.alias(&candidate.owner_user_id, identity.as_bytes());
        if store
            .install_reindexed_bundle_alias(&candidate, &alias.key_revision, &alias.value)
            .await?
        {
            installed += 1;
        }
    }
    Ok(installed)
}

fn jitter(base: Duration) -> Duration {
    let jitter_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| u64::from(duration.subsec_nanos()) % 251);
    base + Duration::from_millis(jitter_millis)
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler must install");
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.expect("Ctrl-C handler must install"),
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c()
        .await
        .expect("Ctrl-C handler must install");
}
