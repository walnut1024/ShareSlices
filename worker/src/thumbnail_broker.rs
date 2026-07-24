use std::{path::PathBuf, time::Duration};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::watch;

use crate::thumbnail::render_thumbnail;

#[derive(Debug, Error)]
pub enum ThumbnailBrokerError {
    #[error("missing or invalid thumbnail broker environment {0}")]
    Configuration(&'static str),
    #[error("thumbnail broker request failed: {0}")]
    Request(String),
    #[error("thumbnail broker rejected the execution")]
    Rejected,
    #[error("thumbnail rendering failed: {0}")]
    Render(String),
    #[error("thumbnail broker response did not match the rendered output")]
    OutputMismatch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    version: u8,
    renderer_revision: String,
    capture_url: String,
    controller_token: String,
    output: OutputContract,
    viewport: Viewport,
    readiness_deadline_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputContract {
    content_type: String,
    width: u32,
    height: u32,
    maximum_bytes: usize,
}

#[derive(Debug, Deserialize)]
struct Viewport {
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Uploaded {
    sha256: String,
    size_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Commit<'a> {
    sha256: &'a str,
    size_bytes: usize,
    width: u32,
    height: u32,
}

/// Runs one grant-bound thumbnail execution without database or storage credentials.
///
/// # Errors
///
/// Returns an error when configuration is absent, the broker rejects a
/// capability or fixed renderer contract, rendering fails, or the uploaded
/// output does not match the locally rendered bytes.
pub async fn run_thumbnail_broker() -> Result<(), ThumbnailBrokerError> {
    let origin = required("SHARESLICES_THUMBNAIL_BROKER_ORIGIN")?;
    let bootstrap_grant = required("SHARESLICES_THUMBNAIL_BOOTSTRAP_GRANT")?;
    let renderer_revision = required("SHARESLICES_ARTIFACT_RENDERER_REVISION")?;
    let chromium_path =
        std::env::var_os("CHROMIUM_PATH").map_or_else(|| PathBuf::from("chromium"), PathBuf::from);
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
    let bootstrap_response = client
        .post(format!("{}/v1/bootstrap", origin.trim_end_matches('/')))
        .bearer_auth(&bootstrap_grant)
        .send()
        .await
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
    if bootstrap_response.status() != StatusCode::OK {
        return Err(ThumbnailBrokerError::Rejected);
    }
    let bootstrap = bootstrap_response
        .json::<Bootstrap>()
        .await
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
    validate_bootstrap(&bootstrap, &renderer_revision)?;

    let (heartbeat_stop, mut heartbeat_stopped) = watch::channel(false);
    let heartbeat_client = client.clone();
    let heartbeat_origin = origin.clone();
    let heartbeat_token = bootstrap.controller_token.clone();
    let heartbeat = tokio::spawn(async move {
        loop {
            tokio::select! {
                () = tokio::time::sleep(Duration::from_secs(10)) => {
                    let response = heartbeat_client
                        .post(format!("{}/v1/heartbeat", heartbeat_origin.trim_end_matches('/')))
                        .bearer_auth(&heartbeat_token)
                        .send()
                        .await
                        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
                    if response.status() != StatusCode::OK {
                        return Err(ThumbnailBrokerError::Rejected);
                    }
                }
                changed = heartbeat_stopped.changed() => {
                    if changed.is_err() || *heartbeat_stopped.borrow() {
                        return Ok(());
                    }
                }
            }
        }
    });

    let target = bootstrap.capture_url.clone();
    let webp = tokio::task::spawn_blocking(move || render_thumbnail(&chromium_path, &target))
        .await
        .map_err(|error| ThumbnailBrokerError::Render(error.to_string()))?
        .map_err(|error| ThumbnailBrokerError::Render(error.to_string()))?;
    if webp.is_empty() || webp.len() > bootstrap.output.maximum_bytes {
        return Err(ThumbnailBrokerError::OutputMismatch);
    }
    let digest = hex_sha256(&webp);
    let upload = client
        .put(format!("{}/v1/output", origin.trim_end_matches('/')))
        .bearer_auth(&bootstrap.controller_token)
        .header("content-type", "image/webp")
        .body(webp)
        .send()
        .await
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
    if upload.status() != StatusCode::CREATED {
        return Err(ThumbnailBrokerError::Rejected);
    }
    let uploaded = upload
        .json::<Uploaded>()
        .await
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
    if uploaded.sha256 != digest || uploaded.size_bytes == 0 {
        return Err(ThumbnailBrokerError::OutputMismatch);
    }
    let committed = client
        .post(format!("{}/v1/commit", origin.trim_end_matches('/')))
        .bearer_auth(&bootstrap.controller_token)
        .json(&Commit {
            sha256: &digest,
            size_bytes: uploaded.size_bytes,
            width: bootstrap.output.width,
            height: bootstrap.output.height,
        })
        .send()
        .await
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))?;
    if committed.status() != StatusCode::OK {
        return Err(ThumbnailBrokerError::Rejected);
    }
    heartbeat_stop.send_replace(true);
    heartbeat
        .await
        .map_err(|error| ThumbnailBrokerError::Request(error.to_string()))??;
    Ok(())
}

fn validate_bootstrap(
    bootstrap: &Bootstrap,
    expected_renderer_revision: &str,
) -> Result<(), ThumbnailBrokerError> {
    if bootstrap.version != 1
        || bootstrap.renderer_revision != expected_renderer_revision
        || bootstrap.output.content_type != "image/webp"
        || bootstrap.output.width != 800
        || bootstrap.output.height != 450
        || bootstrap.output.maximum_bytes == 0
        || bootstrap.viewport.width != 1440
        || bootstrap.viewport.height != 810
        || bootstrap.readiness_deadline_seconds != 10
        || !bootstrap
            .capture_url
            .starts_with("http://shareslices-broker.internal/v1/capture/")
        || bootstrap.controller_token.len() != 43
    {
        return Err(ThumbnailBrokerError::Rejected);
    }
    Ok(())
}

fn required(name: &'static str) -> Result<String, ThumbnailBrokerError> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or(ThumbnailBrokerError::Configuration(name))
}

fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::{Bootstrap, OutputContract, Viewport, validate_bootstrap};

    fn contract(renderer_revision: &str) -> Bootstrap {
        Bootstrap {
            version: 1,
            renderer_revision: renderer_revision.to_owned(),
            capture_url:
                "http://shareslices-broker.internal/v1/capture/version/content/?grant=grant"
                    .to_owned(),
            controller_token: "a".repeat(43),
            output: OutputContract {
                content_type: "image/webp".to_owned(),
                width: 800,
                height: 450,
                maximum_bytes: 2 * 1024 * 1024,
            },
            viewport: Viewport {
                width: 1440,
                height: 810,
            },
            readiness_deadline_seconds: 10,
        }
    }

    #[test]
    fn accepts_the_fixed_renderer_contract() {
        assert!(validate_bootstrap(&contract("renderer-v2"), "renderer-v2").is_ok());
    }

    #[test]
    fn rejects_a_renderer_revision_mismatch() {
        assert!(validate_bootstrap(&contract("renderer-v1"), "renderer-v2").is_err());
    }
}
