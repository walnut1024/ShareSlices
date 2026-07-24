use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReleaseVerificationError {
    #[error("missing or invalid release-verification environment {0}")]
    Configuration(&'static str),
    #[error("release-verification callback failed: {0}")]
    Request(String),
    #[error("release-verification callback was rejected")]
    Rejected,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContainerEvidence {
    version: u8,
    nonce: String,
    release_id: String,
    fence: u64,
    sub_fence: u64,
    container_class: String,
    stable_slot: String,
    provider_instance: String,
    build_identity: String,
    contract_revision: String,
    image_reference: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerProbe {
    version: u8,
    invocation_id: String,
    nonce: String,
    release_id: String,
    fence: u64,
    sub_fence: u64,
}

fn required(name: &'static str) -> Result<String, ReleaseVerificationError> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty() && value.len() <= 512)
        .ok_or(ReleaseVerificationError::Configuration(name))
}

fn positive(name: &'static str) -> Result<u64, ReleaseVerificationError> {
    required(name)?
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or(ReleaseVerificationError::Configuration(name))
}

/// Reports identity embedded in the running image together with the provider
/// identity injected into the actual Cloudflare Container process.
pub async fn report_container_release_identity() -> Result<(), ReleaseVerificationError> {
    let origin = required("SHARESLICES_RELEASE_VERIFICATION_ORIGIN")?;
    if origin != "http://shareslices-release-verifier.internal" {
        return Err(ReleaseVerificationError::Configuration(
            "SHARESLICES_RELEASE_VERIFICATION_ORIGIN",
        ));
    }
    let invocation_id = required("SHARESLICES_RELEASE_VERIFICATION_INVOCATION_ID")?;
    let nonce = required("SHARESLICES_RELEASE_VERIFICATION_NONCE")?;
    let release_id = required("SHARESLICES_CONTAINER_RELEASE_ID")?;
    let fence = positive("SHARESLICES_RELEASE_VERIFICATION_FENCE")?;
    let sub_fence = positive("SHARESLICES_RELEASE_VERIFICATION_SUB_FENCE")?;
    let container_class = required("SHARESLICES_CONTAINER_CLASS")?;
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| ReleaseVerificationError::Request(error.to_string()))?;
    if container_class == "thumbnail" {
        let broker_origin = required("SHARESLICES_RELEASE_VERIFICATION_BROKER_ORIGIN")?;
        if broker_origin != "http://shareslices-broker.internal" {
            return Err(ReleaseVerificationError::Configuration(
                "SHARESLICES_RELEASE_VERIFICATION_BROKER_ORIGIN",
            ));
        }
        let response = client
            .post(format!("{broker_origin}/v1/release-verification"))
            .json(&BrokerProbe {
                version: 1,
                invocation_id: invocation_id.clone(),
                nonce: nonce.clone(),
                release_id: release_id.clone(),
                fence,
                sub_fence,
            })
            .send()
            .await
            .map_err(|error| ReleaseVerificationError::Request(error.to_string()))?;
        if response.status() != StatusCode::OK {
            return Err(ReleaseVerificationError::Rejected);
        }
    }
    let evidence = ContainerEvidence {
        version: 1,
        nonce,
        release_id,
        fence,
        sub_fence,
        container_class,
        stable_slot: required("SHARESLICES_RELEASE_VERIFICATION_STABLE_SLOT")?,
        provider_instance: required("CLOUDFLARE_DEPLOYMENT_ID")?,
        build_identity: required("SHARESLICES_CONTAINER_BUILD_IDENTITY")?,
        contract_revision: required("SHARESLICES_CONTAINER_CONTRACT_REVISION")?,
        image_reference: required("SHARESLICES_CONTAINER_IMAGE_REFERENCE")?,
    };
    let response = client
        .post(format!("{origin}/v1/container-evidence"))
        .json(&evidence)
        .send()
        .await
        .map_err(|error| ReleaseVerificationError::Request(error.to_string()))?;
    if response.status() != StatusCode::NO_CONTENT {
        return Err(ReleaseVerificationError::Rejected);
    }
    Ok(())
}
