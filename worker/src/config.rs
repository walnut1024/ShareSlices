use std::{collections::HashMap, time::Duration};

use thiserror::Error;
use url::Url;

const DEFAULT_WRITE_CONCURRENCY: usize = 4;
const DEFAULT_RECOVERY_LIMIT: i64 = 100;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkerConfig {
    pub database_url: String,
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key_id: String,
    pub s3_secret_access_key: String,
    pub s3_force_path_style: bool,
    pub poll_interval: Duration,
    pub lease_duration: Duration,
    pub heartbeat_interval: Duration,
    pub job_max_attempts: u32,
    pub write_concurrency: usize,
    pub recovery_limit: i64,
    pub deployment_environment: String,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("environment variable {name} has an invalid value: {message}")]
    Invalid {
        name: &'static str,
        message: &'static str,
    },
    #[error("WORKER_JOB_HEARTBEAT_SECONDS must be shorter than WORKER_JOB_LEASE_SECONDS")]
    HeartbeatNotShorterThanLease,
}

impl WorkerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(std::env::vars())
    }

    fn from_values<I, K, V>(values: I) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let values = values
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect::<HashMap<_, _>>();
        let database_url = required(&values, "DATABASE_URL")?;
        validate_url("DATABASE_URL", &database_url)?;
        let s3_endpoint = required(&values, "S3_ENDPOINT")?;
        validate_http_url("S3_ENDPOINT", &s3_endpoint)?;
        let s3_region = required(&values, "S3_REGION")?;
        let s3_bucket = required(&values, "S3_BUCKET")?;
        validate_bucket(&s3_bucket)?;
        let s3_access_key_id = required(&values, "S3_ACCESS_KEY_ID")?;
        let s3_secret_access_key = required(&values, "S3_SECRET_ACCESS_KEY")?;
        let s3_force_path_style = parse_bool(&values, "S3_FORCE_PATH_STYLE")?;
        let poll_interval =
            Duration::from_millis(parse_positive(&values, "WORKER_JOB_POLL_INTERVAL_MS")?);
        let lease_duration =
            Duration::from_secs(parse_positive(&values, "WORKER_JOB_LEASE_SECONDS")?);
        let heartbeat_interval =
            Duration::from_secs(parse_positive(&values, "WORKER_JOB_HEARTBEAT_SECONDS")?);
        if heartbeat_interval >= lease_duration {
            return Err(ConfigError::HeartbeatNotShorterThanLease);
        }
        let job_max_attempts =
            u32::try_from(parse_positive(&values, "WORKER_JOB_MAX_ATTEMPTS")?)
                .map_err(|_| invalid("WORKER_JOB_MAX_ATTEMPTS", "must fit in 32 bits"))?;

        Ok(Self {
            database_url,
            s3_endpoint,
            s3_region,
            s3_bucket,
            s3_access_key_id,
            s3_secret_access_key,
            s3_force_path_style,
            poll_interval,
            lease_duration,
            heartbeat_interval,
            job_max_attempts,
            write_concurrency: DEFAULT_WRITE_CONCURRENCY,
            recovery_limit: DEFAULT_RECOVERY_LIMIT,
            deployment_environment: values
                .get("NODE_ENV")
                .cloned()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "development".to_owned()),
        })
    }
}

fn required(values: &HashMap<String, String>, name: &'static str) -> Result<String, ConfigError> {
    values
        .get(name)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or(ConfigError::Missing(name))
}

fn validate_url(name: &'static str, value: &str) -> Result<(), ConfigError> {
    Url::parse(value)
        .map(|_| ())
        .map_err(|_| invalid(name, "must be an absolute URL"))
}

fn validate_http_url(name: &'static str, value: &str) -> Result<(), ConfigError> {
    let url = Url::parse(value).map_err(|_| invalid(name, "must be an absolute HTTP URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(invalid(name, "must use http or https"));
    }
    Ok(())
}

fn validate_bucket(value: &str) -> Result<(), ConfigError> {
    let valid_length = (3..=63).contains(&value.len());
    let valid_edges = value
        .as_bytes()
        .first()
        .zip(value.as_bytes().last())
        .is_some_and(|(first, last)| first.is_ascii_alphanumeric() && last.is_ascii_alphanumeric());
    let valid_characters = value.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
    });
    if valid_length && valid_edges && valid_characters {
        Ok(())
    } else {
        Err(invalid("S3_BUCKET", "must be a valid S3 bucket name"))
    }
}

fn parse_bool(values: &HashMap<String, String>, name: &'static str) -> Result<bool, ConfigError> {
    match required(values, name)?.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(invalid(name, "must be true or false")),
    }
}

fn parse_positive(
    values: &HashMap<String, String>,
    name: &'static str,
) -> Result<u64, ConfigError> {
    required(values, name)?
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| invalid(name, "must be a positive integer"))
}

const fn invalid(name: &'static str, message: &'static str) -> ConfigError {
    ConfigError::Invalid { name, message }
}

#[cfg(test)]
mod tests {
    use super::{ConfigError, WorkerConfig};

    #[test]
    fn parses_the_deployment_contract() {
        let config = WorkerConfig::from_values(valid_values()).expect("valid config");

        assert_eq!(config.poll_interval.as_millis(), 250);
        assert_eq!(config.lease_duration.as_secs(), 30);
        assert_eq!(config.heartbeat_interval.as_secs(), 10);
        assert!(config.s3_force_path_style);
        assert_eq!(config.deployment_environment, "test");
    }

    #[test]
    fn rejects_missing_and_malformed_values() {
        let mut missing = valid_values();
        missing.retain(|(name, _)| *name != "DATABASE_URL");
        assert_eq!(
            WorkerConfig::from_values(missing),
            Err(ConfigError::Missing("DATABASE_URL"))
        );

        let mut malformed = valid_values();
        replace(&mut malformed, "S3_FORCE_PATH_STYLE", "yes");
        assert!(matches!(
            WorkerConfig::from_values(malformed),
            Err(ConfigError::Invalid {
                name: "S3_FORCE_PATH_STYLE",
                ..
            })
        ));
    }

    #[test]
    fn rejects_a_heartbeat_that_cannot_renew_the_lease_in_time() {
        let mut values = valid_values();
        replace(&mut values, "WORKER_JOB_HEARTBEAT_SECONDS", "30");

        assert_eq!(
            WorkerConfig::from_values(values),
            Err(ConfigError::HeartbeatNotShorterThanLease)
        );
    }

    fn valid_values() -> Vec<(&'static str, &'static str)> {
        vec![
            ("DATABASE_URL", "postgres://user:pass@localhost/database"),
            ("S3_ENDPOINT", "http://localhost:9000"),
            ("S3_REGION", "us-east-1"),
            ("S3_BUCKET", "shareslices-artifacts"),
            ("S3_ACCESS_KEY_ID", "access"),
            ("S3_SECRET_ACCESS_KEY", "secret"),
            ("S3_FORCE_PATH_STYLE", "true"),
            ("WORKER_JOB_POLL_INTERVAL_MS", "250"),
            ("WORKER_JOB_LEASE_SECONDS", "30"),
            ("WORKER_JOB_HEARTBEAT_SECONDS", "10"),
            ("WORKER_JOB_MAX_ATTEMPTS", "3"),
            ("NODE_ENV", "test"),
        ]
    }

    fn replace(values: &mut Vec<(&'static str, &'static str)>, name: &str, value: &'static str) {
        values
            .iter_mut()
            .find(|(key, _)| *key == name)
            .expect("key exists")
            .1 = value;
    }
}
