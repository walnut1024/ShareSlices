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
    pub thumbnail_internal_api_origin: String,
    pub chromium_path: std::path::PathBuf,
    pub content_fingerprint_key_current: String,
    pub content_fingerprint_key_current_revision: String,
    pub content_fingerprint_key_previous: Option<String>,
    pub content_fingerprint_key_previous_revision: Option<String>,
    pub content_identity_revision: String,
    pub processing_revision: String,
    pub renderer_revision: String,
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
        let thumbnail_internal_api_origin = required(&values, "THUMBNAIL_INTERNAL_API_ORIGIN")?;
        validate_http_url(
            "THUMBNAIL_INTERNAL_API_ORIGIN",
            &thumbnail_internal_api_origin,
        )?;
        let chromium_path = std::path::PathBuf::from(required(&values, "CHROMIUM_PATH")?);
        let content_fingerprint_key_current =
            required_minimum(&values, "CONTENT_FINGERPRINT_KEY_CURRENT", 32)?;
        let content_fingerprint_key_current_revision =
            required_revision(&values, "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION")?;
        let content_fingerprint_key_previous = optional_pair(
            &values,
            "CONTENT_FINGERPRINT_KEY_PREVIOUS",
            "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION",
        )?;
        let content_fingerprint_key_previous_revision = content_fingerprint_key_previous
            .as_ref()
            .map(|(_, revision)| revision.clone());
        let content_fingerprint_key_previous = content_fingerprint_key_previous.map(|(key, _)| key);

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
            thumbnail_internal_api_origin,
            chromium_path,
            content_fingerprint_key_current,
            content_fingerprint_key_current_revision,
            content_fingerprint_key_previous,
            content_fingerprint_key_previous_revision,
            content_identity_revision: required_revision(&values, "CONTENT_IDENTITY_REVISION")?,
            processing_revision: required_revision(&values, "ARTIFACT_PROCESSING_REVISION")?,
            renderer_revision: required_revision(&values, "ARTIFACT_RENDERER_REVISION")?,
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

fn required_minimum(
    values: &HashMap<String, String>,
    name: &'static str,
    minimum: usize,
) -> Result<String, ConfigError> {
    let value = required(values, name)?;
    if value.len() < minimum {
        return Err(invalid(name, "must contain at least 32 bytes"));
    }
    Ok(value)
}

fn required_revision(
    values: &HashMap<String, String>,
    name: &'static str,
) -> Result<String, ConfigError> {
    let value = required(values, name)?;
    let valid = value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        });
    if !valid {
        return Err(invalid(name, "must be a safe lowercase revision token"));
    }
    Ok(value)
}

fn optional_pair(
    values: &HashMap<String, String>,
    key_name: &'static str,
    revision_name: &'static str,
) -> Result<Option<(String, String)>, ConfigError> {
    match (
        values.get(key_name).filter(|value| !value.is_empty()),
        values.get(revision_name).filter(|value| !value.is_empty()),
    ) {
        (None, None) => Ok(None),
        (Some(key), Some(_)) if key.len() >= 32 => Ok(Some((
            key.clone(),
            required_revision(values, revision_name)?,
        ))),
        (Some(_), Some(_)) => Err(invalid(key_name, "must contain at least 32 bytes")),
        (Some(_), None) => Err(ConfigError::Missing(revision_name)),
        (None, Some(_)) => Err(ConfigError::Missing(key_name)),
    }
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
        assert_eq!(config.content_identity_revision, "content-v1");
        assert_eq!(config.renderer_revision, "renderer-v2");
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

        let mut missing_fingerprint_key = valid_values();
        missing_fingerprint_key.retain(|(name, _)| *name != "CONTENT_FINGERPRINT_KEY_CURRENT");
        assert_eq!(
            WorkerConfig::from_values(missing_fingerprint_key),
            Err(ConfigError::Missing("CONTENT_FINGERPRINT_KEY_CURRENT"))
        );
    }

    #[test]
    fn requires_previous_fingerprint_key_and_revision_together() {
        let mut values = valid_values();
        values.push((
            "CONTENT_FINGERPRINT_KEY_PREVIOUS",
            "previous-content-fingerprint-key-32",
        ));

        assert_eq!(
            WorkerConfig::from_values(values),
            Err(ConfigError::Missing(
                "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION"
            ))
        );
    }

    #[test]
    fn rejects_revisions_that_are_unsafe_in_object_keys() {
        let mut values = valid_values();
        replace(&mut values, "ARTIFACT_RENDERER_REVISION", "../renderer");

        assert!(matches!(
            WorkerConfig::from_values(values),
            Err(ConfigError::Invalid {
                name: "ARTIFACT_RENDERER_REVISION",
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
            ("THUMBNAIL_INTERNAL_API_ORIGIN", "http://127.0.0.1:7456"),
            ("CHROMIUM_PATH", "chromium"),
            (
                "CONTENT_FINGERPRINT_KEY_CURRENT",
                "development-content-fingerprint-key-32",
            ),
            ("CONTENT_FINGERPRINT_KEY_CURRENT_REVISION", "key-v1"),
            ("CONTENT_IDENTITY_REVISION", "content-v1"),
            ("ARTIFACT_PROCESSING_REVISION", "processing-v1"),
            ("ARTIFACT_RENDERER_REVISION", "renderer-v2"),
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
