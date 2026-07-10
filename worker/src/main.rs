// cspell:ignore subsec
mod config;
mod runtime;

use std::{sync::Arc, time::Duration};

use aws_sdk_s3::config::{Credentials, Region};
use config::WorkerConfig;
use runtime::{
    PostgresInputSource, ProductionRuntime, RuntimeConfig, StorageAttemptProcessor, WorkerRuntime,
};
use shareslices_worker::{
    job_store::PostgresJobStore,
    logging::{LogConfig, SanitizedException, Severity, WorkerEvent},
    object_storage::AwsS3ObjectStorage,
    retry_policy::RetryPolicy,
};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() {
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

    if let Err(error) = run(config).await {
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

async fn run(config: WorkerConfig) -> Result<(), sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
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
    let storage =
        AwsS3ObjectStorage::new(aws_sdk_s3::Client::from_conf(s3_config), &config.s3_bucket);
    let store = Arc::new(PostgresJobStore::new(pool.clone()));
    let runtime: ProductionRuntime = WorkerRuntime::new(
        store,
        PostgresInputSource::new(pool.clone()),
        StorageAttemptProcessor::new(storage),
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

    WorkerEvent::new(
        Severity::Info,
        "shareslices.worker.started",
        "worker started",
    )
    .emit();
    runtime.run_until(shutdown_signal()).await;
    pool.close().await;
    Ok(())
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
