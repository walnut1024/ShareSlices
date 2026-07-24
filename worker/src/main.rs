// cspell:ignore oneshot subsec
mod config;
mod runtime;

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use aws_sdk_s3::config::{Credentials, Region};
use config::WorkerConfig;
use runtime::{
    PostgresInputSource, ProductionRuntime, RuntimeConfig, StorageAttemptProcessor, WorkerRuntime,
};
use shareslices_worker::{
    bundle_alias::BundleAliasLane,
    content_fingerprint::{FingerprintError, FingerprintKey},
    drain_command::DrainCommand,
    gallery_copy_job::GalleryCopyLane,
    gallery_cover_job::GalleryCoverLane,
    gallery_safety_job::GallerySafetyLane,
    health::{DEFAULT_READY_FILE, ReadyFile},
    job_store::PostgresJobStore,
    logging::{LogConfig, SanitizedException, Severity, WorkerEvent},
    object_storage::AwsS3ObjectStorage,
    release_verification::report_container_release_identity,
    retry_policy::RetryPolicy,
    runner::{BackgroundLane, DrainLimits, Runner, RunnerError, RunnerLane},
    thumbnail::{ThumbnailConfig, ThumbnailLane, preflight_chromium, requeue_failed_browser_jobs},
    thumbnail_broker::run_thumbnail_broker,
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

#[tokio::main]
async fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let command = arguments.first().map(String::as_str);
    if command == Some("healthcheck") {
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
    if command == Some("thumbnail-broker") {
        if let Err(error) = run_thumbnail_broker().await {
            eprintln!("thumbnail broker execution failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if command == Some("release-verification") {
        if let Err(error) = report_container_release_identity().await {
            eprintln!("release verification failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    let drain_command = if command == Some("drain") {
        match DrainCommand::parse(&arguments[1..]) {
            Ok(command) => Some(command),
            Err(error) => {
                eprintln!("invalid drain command: {error}");
                std::process::exit(2);
            }
        }
    } else {
        None
    };
    if let Some(command) = command
        && command != "requeue-failed-thumbnails"
        && command != "drain"
        && command != "thumbnail-broker"
        && command != "release-verification"
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

    let result = if command == Some("requeue-failed-thumbnails") {
        requeue_failed_thumbnails(&config).await.map(|()| false)
    } else if let Some(command) = drain_command {
        run_bounded(config, command).await
    } else {
        run(config).await.map(|()| false)
    };
    match result {
        Ok(true) => std::process::exit(75),
        Ok(false) => {}
        Err(error) => {
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
    let runtime: Arc<ProductionRuntime> = Arc::new(WorkerRuntime::new(
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
            lease_duration: config.lease_duration,
            heartbeat_interval: config.heartbeat_interval,
            write_concurrency: config.write_concurrency,
            recovery_limit: config.recovery_limit,
            configured_max_attempts: config.job_max_attempts,
        },
    ));
    let runner = single_lane_runner(
        Arc::clone(&runtime) as Arc<dyn BackgroundLane>,
        RunnerLane::ArtifactProcessing,
        config.poll_interval,
    )?;
    let _ready_guard = readiness.mark_ready()?;

    WorkerEvent::new(
        Severity::Info,
        "shareslices.worker.started",
        "worker started",
    )
    .emit();
    let (shutdown_sender, shutdown_receiver) = tokio::sync::watch::channel(false);
    let alias_lane = Arc::new(BundleAliasLane::new(
        Arc::clone(&store),
        storage.clone(),
        current_fingerprint_key,
    ));
    let alias_runner = single_lane_runner(
        alias_lane as Arc<dyn BackgroundLane>,
        RunnerLane::BundleAlias,
        Duration::from_secs(30),
    )?;
    let (safety_runner, cover_runner, copy_runner) = gallery_runners(&pool, &storage, &config)?;
    let thumbnail_lane = Arc::new(ThumbnailLane::new(
        pool.clone(),
        storage,
        ThumbnailConfig {
            worker_id: format!("thumbnail-worker-{}", Uuid::new_v4()),
            internal_api_origin: config.thumbnail_internal_api_origin,
            chromium_path: config.chromium_path,
            lease_duration: config.lease_duration,
        },
    ));
    let thumbnail_runner = single_lane_runner(
        thumbnail_lane as Arc<dyn BackgroundLane>,
        RunnerLane::Thumbnail,
        config.poll_interval,
    )?;
    let (
        processing_result,
        thumbnail_result,
        alias_result,
        safety_result,
        cover_result,
        copy_result,
        (),
    ) = tokio::join!(
        runner.run_resident(shutdown_receiver.clone(), config.lease_duration),
        thumbnail_runner.run_resident(shutdown_receiver.clone(), config.lease_duration),
        alias_runner.run_resident(shutdown_receiver.clone(), config.lease_duration),
        safety_runner.run_resident(shutdown_receiver.clone(), config.lease_duration),
        cover_runner.run_resident(shutdown_receiver.clone(), config.lease_duration),
        copy_runner.run_resident(shutdown_receiver, config.lease_duration),
        coordinate_shutdown(shutdown_sender),
    );
    processing_result?;
    thumbnail_result?;
    alias_result?;
    safety_result?;
    cover_result?;
    copy_result?;
    pool.close().await;
    Ok(())
}

async fn run_bounded(
    config: WorkerConfig,
    command: DrainCommand,
) -> Result<bool, Box<dyn std::error::Error>> {
    if command.lanes.contains(&RunnerLane::Thumbnail) {
        preflight_chromium(&config.chromium_path)?;
    }
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    let storage = configured_storage(&config);
    let store = Arc::new(PostgresJobStore::new(pool.clone()));
    let (current_fingerprint_key, previous_fingerprint_key) = fingerprint_keys(&config)?;
    let runtime: Arc<ProductionRuntime> = Arc::new(WorkerRuntime::new(
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
            worker_id: format!("bounded-worker-{}", Uuid::new_v4()),
            lease_duration: config.lease_duration,
            heartbeat_interval: config.heartbeat_interval,
            write_concurrency: config.write_concurrency,
            recovery_limit: config.recovery_limit,
            configured_max_attempts: config.job_max_attempts,
        },
    ));
    let mut lanes: Vec<Arc<dyn BackgroundLane>> = vec![
        runtime,
        Arc::new(ThumbnailLane::new(
            pool.clone(),
            storage.clone(),
            ThumbnailConfig {
                worker_id: format!("bounded-thumbnail-worker-{}", Uuid::new_v4()),
                internal_api_origin: config.thumbnail_internal_api_origin.clone(),
                chromium_path: config.chromium_path.clone(),
                lease_duration: config.lease_duration,
            },
        )),
        Arc::new(BundleAliasLane::new(
            Arc::clone(&store),
            storage.clone(),
            current_fingerprint_key,
        )),
        Arc::new(GallerySafetyLane::new(
            pool.clone(),
            Arc::new(storage.clone()),
            format!("bounded-gallery-safety-worker-{}", Uuid::new_v4()),
            config.lease_duration,
        )),
        Arc::new(GalleryCoverLane::new(pool.clone())),
        Arc::new(GalleryCopyLane::new(
            pool.clone(),
            Arc::new(storage),
            format!("bounded-gallery-copy-worker-{}", Uuid::new_v4()),
            config.lease_duration,
        )),
    ];
    lanes.retain(|lane| command.lanes.contains(&lane.lane()));
    let runner = Runner::new(lanes, &command.lanes, config.poll_interval)?;
    let (shutdown_sender, shutdown_receiver) = tokio::sync::watch::channel(false);
    let drain = runner.run_drain(
        DrainLimits {
            maximum_claims: command.maximum_claims,
            maximum_idle_observations: command.maximum_idle_observations,
            wall_deadline: tokio::time::Instant::now() + command.wall_time,
        },
        shutdown_receiver,
    );
    tokio::pin!(drain);
    let outcome = tokio::select! {
        result = &mut drain => result?,
        () = shutdown_signal() => {
            shutdown_sender.send_replace(true);
            drain.await?
        }
    };
    println!("{}", serde_json::to_string(&outcome)?);
    pool.close().await;
    Ok(outcome.remaining_work)
}

fn single_lane_runner(
    lane: Arc<dyn BackgroundLane>,
    lane_id: RunnerLane,
    poll_interval: Duration,
) -> Result<Runner, RunnerError> {
    Runner::new(vec![lane], &BTreeSet::from([lane_id]), poll_interval)
}

fn gallery_runners(
    pool: &PgPool,
    storage: &AwsS3ObjectStorage,
    config: &WorkerConfig,
) -> Result<(Runner, Runner, Runner), RunnerError> {
    let safety = Arc::new(GallerySafetyLane::new(
        pool.clone(),
        Arc::new(storage.clone()),
        format!("gallery-safety-worker-{}", Uuid::new_v4()),
        config.lease_duration,
    ));
    let cover = Arc::new(GalleryCoverLane::new(pool.clone()));
    let copy = Arc::new(GalleryCopyLane::new(
        pool.clone(),
        Arc::new(storage.clone()),
        format!("gallery-copy-worker-{}", Uuid::new_v4()),
        config.lease_duration,
    ));
    Ok((
        single_lane_runner(
            safety as Arc<dyn BackgroundLane>,
            RunnerLane::GallerySafety,
            config.poll_interval,
        )?,
        single_lane_runner(
            cover as Arc<dyn BackgroundLane>,
            RunnerLane::GalleryCover,
            config.poll_interval,
        )?,
        single_lane_runner(
            copy as Arc<dyn BackgroundLane>,
            RunnerLane::GalleryCopy,
            config.poll_interval,
        )?,
    ))
}

async fn coordinate_shutdown(shutdown_sender: tokio::sync::watch::Sender<bool>) {
    shutdown_signal().await;
    shutdown_sender.send_replace(true);
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
