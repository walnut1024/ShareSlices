use crate::{
    ApiErrorEvidence, Artifact, ArtifactAccepted, ArtifactDetail, ArtifactError, ArtifactState,
    AuthApi, AuthError, Authorization, Exchange, ExpirationPolicy, GalleryViewResult,
    ProcessingFilter, PublicationFilter, PublishedResult, ReadyArtifactVersion, UploadPolicy, User,
};
use async_trait::async_trait;
use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;

const CLIENT_ID: &str = "shareslices-cli";

pub struct ApiClient {
    base_url: url::Url,
    client: Client,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    fields: Option<serde_json::Value>,
    #[serde(default)]
    details: Option<serde_json::Value>,
}

impl ApiClient {
    /// Reads owner Gallery state together with current permission availability.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, or invalid Server responses.
    pub async fn gallery_view(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<GalleryViewResult, ArtifactError> {
        let listing = self
            .gallery_json(
                self.request(
                    reqwest::Method::GET,
                    &format!("/api/artifacts/{artifact_id}/gallery-listing"),
                )
                .bearer_auth(token),
            )
            .await?;
        let grant = self
            .gallery_json(
                self.request(reqwest::Method::GET, "/api/gallery/permission-grant")
                    .bearer_auth(token),
            )
            .await;
        let profile = self
            .gallery_json(
                self.request(reqwest::Method::GET, "/api/gallery/profile")
                    .bearer_auth(token),
            )
            .await?;
        let current_grant = grant
            .ok()
            .and_then(|value| value.get("grant").cloned())
            .filter(|value| !value.is_null());
        let listing = listing
            .get("listing")
            .or_else(|| listing.get("gallery"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let historical = listing
            .get("historicalGrantEvidence")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]));
        let grant_available = current_grant.is_some();
        serde_json::from_value(serde_json::json!({
            "artifactId": artifact_id,
            "listing": listing,
            "currentGrant": current_grant,
            "historicalGrantEvidence": historical,
            "grantAvailability": if grant_available { "available" } else { "no_current_grant" },
            "profileRequirement": if profile.get("profile").is_none_or(serde_json::Value::is_null) { Some("confirm_display_name") } else { None::<&str> }
        }))
        .map_err(|_| ArtifactError::Server)
    }

    /// Sends one idempotent, revision-checked Gallery owner mutation.
    ///
    /// # Errors
    /// Returns an Artifact error for authorization, conflicts, transport, or invalid responses.
    pub async fn gallery_mutate(
        &self,
        token: &str,
        method: reqwest::Method,
        path: &str,
        body: Option<&serde_json::Value>,
        idempotency_key: &str,
        listing_revision: Option<u64>,
    ) -> Result<serde_json::Value, ArtifactError> {
        let mut request = self
            .request(method, path)
            .bearer_auth(token)
            .header("Idempotency-Key", idempotency_key);
        if let Some(revision) = listing_revision {
            request = request.header("If-Match", format!("\"{revision}\""));
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        self.gallery_json(request).await
    }

    async fn gallery_json(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<serde_json::Value, ArtifactError> {
        let response = request
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response.json().await.map_err(|_| ArtifactError::Server)
    }

    /// Downloads one owned ready Version as a normalized ZIP.
    ///
    /// # Errors
    /// Returns an Artifact error for authorization, transport, state, or response failures.
    pub async fn export_version(
        &self,
        token: &str,
        artifact_id: &str,
        version_id: &str,
    ) -> Result<Response, ArtifactError> {
        let response = self
            .request(
                reqwest::Method::GET,
                &format!("/api/versions/{version_id}/export"),
            )
            .bearer_auth(token)
            .query(&[("artifactId", artifact_id)])
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        Ok(response)
    }

    /// Creates a `ShareSlices` API client.
    ///
    /// # Errors
    /// Returns [`AuthError::InvalidApiUrl`] when `base_url` is not a valid URL.
    pub fn new(base_url: &str) -> Result<Self, AuthError> {
        Ok(Self {
            base_url: url::Url::parse(base_url).map_err(|_| AuthError::InvalidApiUrl)?,
            client: Client::new(),
        })
    }

    /// Reads the active upload policy used for local packaging bounds.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, or response failures.
    pub async fn upload_policy(&self, token: &str) -> Result<UploadPolicy, ArtifactError> {
        #[derive(Deserialize)]
        struct Body {
            policy: UploadPolicy,
        }
        let response = self
            .request(
                reqwest::Method::GET,
                "/api/artifact-upload-policies/current",
            )
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response
            .json::<Body>()
            .await
            .map(|body| body.policy)
            .map_err(|_| ArtifactError::Server)
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, self.base_url.join(path).expect("fixed API path"))
            .header("ShareSlices-CLI-Version", env!("CARGO_PKG_VERSION"))
            .header("ShareSlices-CLI-OS", std::env::consts::OS)
    }

    async fn error(response: Response) -> AuthError {
        let status = response.status();
        let retry_after_seconds = retry_after_seconds(&response);
        let header_request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        let body = response.json::<ErrorEnvelope>().await.ok();
        body.map_or_else(
            || {
                if status == StatusCode::UNAUTHORIZED {
                    AuthError::Unauthenticated
                } else {
                    AuthError::Server
                }
            },
            |value| {
                AuthError::ServerEvidence(Box::new(ApiErrorEvidence {
                    code: value.error.code,
                    message: value.error.message,
                    request_id: value.error.request_id.or(header_request_id),
                    action: value.error.action,
                    fields: value.error.fields,
                    details: value.error.details,
                    retry_after_seconds,
                    status: status.as_u16(),
                }))
            },
        )
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<Response, AuthError> {
        request
            .send()
            .await
            .map_err(|error| AuthError::Network(error.to_string()))
    }

    async fn artifact_error(response: Response) -> ArtifactError {
        let status = response.status();
        let retry_after_seconds = retry_after_seconds(&response);
        let header_request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        let body = response.json::<ErrorEnvelope>().await.ok();
        body.map_or_else(
            || {
                if status == StatusCode::UNAUTHORIZED {
                    ArtifactError::Unauthenticated
                } else {
                    ArtifactError::Server
                }
            },
            |value| {
                ArtifactError::ServerEvidence(Box::new(ApiErrorEvidence {
                    code: value.error.code,
                    message: value.error.message,
                    request_id: value.error.request_id.or(header_request_id),
                    action: value.error.action,
                    fields: value.error.fields,
                    details: value.error.details,
                    retry_after_seconds,
                    status: status.as_u16(),
                }))
            },
        )
    }

    async fn upload_error(
        response: Response,
        fallback_delay: std::time::Duration,
    ) -> (ArtifactError, Option<std::time::Duration>) {
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return (ArtifactError::Unauthenticated, None);
        }
        let retry_header = retry_after_seconds(&response);
        let header_request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        let retry_after = retry_header
            .map_or(fallback_delay, std::time::Duration::from_secs)
            .min(std::time::Duration::from_secs(5));
        let body = response.json::<ErrorEnvelope>().await.ok();
        let code = body.as_ref().map(|value| value.error.code.as_str());
        let retryable = status == StatusCode::TOO_MANY_REQUESTS
            || status.is_server_error()
            || code == Some("operation_in_progress");
        let error = body.map_or(ArtifactError::Server, |value| {
            ArtifactError::ServerEvidence(Box::new(ApiErrorEvidence {
                code: value.error.code,
                message: value.error.message,
                request_id: value.error.request_id.or(header_request_id),
                action: value.error.action,
                fields: value.error.fields,
                details: value.error.details,
                retry_after_seconds: retry_header,
                status: status.as_u16(),
            }))
        });
        (error, retryable.then_some(retry_after))
    }

    /// Lists owned Artifacts, following Server pages until `limit` is reached.
    ///
    /// # Errors
    /// Returns [`ArtifactError`] when authentication, transport, or response decoding fails.
    pub async fn list_artifacts(
        &self,
        token: &str,
        publication: Option<PublicationFilter>,
        processing: Option<ProcessingFilter>,
        limit: usize,
    ) -> Result<Vec<Artifact>, ArtifactError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Page {
            artifacts: Vec<Artifact>,
            next_page_token: Option<String>,
        }
        let mut artifacts = Vec::new();
        let mut page_token: Option<String> = None;
        while artifacts.len() < limit {
            let page_size = (limit - artifacts.len()).min(100);
            let mut request = self
                .request(reqwest::Method::GET, "/api/artifacts")
                .bearer_auth(token)
                .query(&[("pageSize", page_size.to_string())]);
            if let Some(value) = publication {
                request = request.query(&[("publication", format!("{value:?}").to_lowercase())]);
            }
            if let Some(value) = processing {
                request = request.query(&[("processing", format!("{value:?}").to_lowercase())]);
            }
            if let Some(value) = &page_token {
                request = request.query(&[("pageToken", value)]);
            }
            let response = request
                .send()
                .await
                .map_err(|error| ArtifactError::Network(error.to_string()))?;
            if !response.status().is_success() {
                return Err(Self::artifact_error(response).await);
            }
            let page = response
                .json::<Page>()
                .await
                .map_err(|_| ArtifactError::Server)?;
            artifacts.extend(page.artifacts);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        artifacts.truncate(limit);
        Ok(artifacts)
    }

    /// Reads one owned Artifact's current management state.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, authorization, or decoding failures.
    pub async fn artifact(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<ArtifactDetail, ArtifactError> {
        #[derive(Deserialize)]
        struct Body {
            artifact: ArtifactDetail,
        }
        let response = self
            .request(
                reqwest::Method::GET,
                &format!("/api/artifacts/{artifact_id}"),
            )
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response
            .json::<Body>()
            .await
            .map(|body| body.artifact)
            .map_err(|_| ArtifactError::Server)
    }

    /// Permanently deletes one owned Artifact without retrying an uncertain mutation.
    ///
    /// # Errors
    /// Returns a typed error for authentication, state conflict, absence, or an indeterminate
    /// network/Server result.
    pub async fn delete_artifact(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<(), ArtifactError> {
        let response = self
            .request(
                reqwest::Method::DELETE,
                &format!("/api/artifacts/{artifact_id}"),
            )
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| ArtifactError::DeleteConfirmationPending)?;
        match response.status() {
            StatusCode::NO_CONTENT => Ok(()),
            StatusCode::UNAUTHORIZED => Err(ArtifactError::Unauthenticated),
            StatusCode::NOT_FOUND => Err(ArtifactError::ArtifactNotFound),
            StatusCode::CONFLICT => Err(ArtifactError::DeleteProcessingActive),
            status if status.is_server_error() => Err(ArtifactError::DeleteConfirmationPending),
            _ => Err(Self::artifact_error(response).await),
        }
    }

    /// Lists ready Versions for one owned Artifact.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, authorization, or decoding failures.
    pub async fn list_ready_versions(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<Vec<ReadyArtifactVersion>, ArtifactError> {
        #[derive(Deserialize)]
        struct Body {
            versions: Vec<ReadyArtifactVersion>,
        }
        let response = self
            .request(
                reqwest::Method::GET,
                &format!("/api/artifacts/{artifact_id}/versions"),
            )
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response
            .json::<Body>()
            .await
            .map(|body| body.versions)
            .map_err(|_| ArtifactError::Server)
    }

    /// Publishes one explicit ready Version.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, ownership, state, or decoding failures.
    pub async fn publish(
        &self,
        token: &str,
        artifact_id: &str,
        version_id: &str,
        expiration_policy: &ExpirationPolicy,
        replace_link: bool,
        confirm_replace_link: bool,
    ) -> Result<PublishedResult, ArtifactError> {
        let response = self
            .request(
                reqwest::Method::POST,
                &format!("/api/artifacts/{artifact_id}/publications"),
            )
            .bearer_auth(token)
            .header("Idempotency-Key", format!("cli-{}", uuid::Uuid::new_v4()))
            .json(&serde_json::json!({
                "versionId": version_id,
                "expiration": expiration_policy,
                "link": if replace_link {
                    serde_json::json!({ "mode": "replace", "confirmRetire": confirm_replace_link })
                } else {
                    serde_json::json!({ "mode": "reuse" })
                }
            }))
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response
            .json::<PublishedResult>()
            .await
            .map_err(|_| ArtifactError::Server)
    }

    /// Removes one current Publication while preserving the Artifact and Share link.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, ownership, or Server failures.
    pub async fn unpublish(
        &self,
        token: &str,
        artifact_id: &str,
        publication_id: &str,
    ) -> Result<(), ArtifactError> {
        let response = self
            .request(
                reqwest::Method::DELETE,
                &format!("/api/artifacts/{artifact_id}/publications/{publication_id}"),
            )
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        Ok(())
    }

    /// Sets or clears the current Publication expiration without publishing again.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, ownership, validation, or decoding failures.
    pub async fn set_publication_expiration(
        &self,
        token: &str,
        artifact_id: &str,
        publication_id: &str,
        expires_at: Option<&str>,
    ) -> Result<ArtifactDetail, ArtifactError> {
        #[derive(Deserialize)]
        struct Body {
            artifact: ArtifactDetail,
        }
        let response = self
            .request(
                reqwest::Method::PATCH,
                &format!("/api/artifacts/{artifact_id}/publications/{publication_id}"),
            )
            .bearer_auth(token)
            .json(&serde_json::json!({
                "expiration": expires_at.map_or_else(
                    || serde_json::json!({"kind":"permanent"}),
                    |value| serde_json::json!({"kind":"exact","expiresAt":value})
                )
            }))
            .send()
            .await
            .map_err(|error| ArtifactError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response
            .json::<Body>()
            .await
            .map(|body| body.artifact)
            .map_err(|_| ArtifactError::Server)
    }

    /// Uploads one prepared ZIP using one idempotency key across transient retries.
    ///
    /// # Errors
    /// Returns an Artifact error for local input, authentication, transport, or Server failures.
    pub async fn upload_artifact(
        &self,
        token: &str,
        name: Option<&str>,
        artifact_id: Option<&str>,
        entry: Option<&str>,
        path: &std::path::Path,
        progress: Option<tokio::sync::mpsc::UnboundedSender<u64>>,
    ) -> Result<ArtifactAccepted, ArtifactError> {
        use tokio::io::AsyncReadExt;
        let length = path
            .metadata()
            .map_err(|_| ArtifactError::InvalidZipInput)?
            .len();
        let filename = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("artifact.zip");
        let idempotency_key = format!("cli-{}", uuid::Uuid::new_v4());
        let mut response = None;
        let mut acceptance_uncertain = false;
        for attempt in 0..10 {
            let mut source = tokio::fs::File::open(path)
                .await
                .map_err(|_| ArtifactError::InvalidZipInput)?;
            let reporter = progress.clone();
            let stream = async_stream::stream! {
                let mut sent = 0_u64;
                let mut buffer = vec![0_u8; 64 * 1024];
                loop {
                    let read = match source.read(&mut buffer).await {
                        Ok(read) => read,
                        Err(error) => { yield Err::<bytes::Bytes, std::io::Error>(error); break; }
                    };
                    if read == 0 { break; }
                    sent += u64::try_from(read).unwrap_or(u64::MAX);
                    if let Some(reporter) = &reporter { let _ = reporter.send(sent); }
                    yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::copy_from_slice(&buffer[..read]));
                }
            };
            let file = reqwest::multipart::Part::stream_with_length(
                reqwest::Body::wrap_stream(stream),
                length,
            )
            .file_name(filename.to_owned())
            .mime_str("application/zip")
            .map_err(|_| ArtifactError::InvalidZipInput)?;
            let mut form = reqwest::multipart::Form::new();
            if let Some(name) = name {
                form = form.text("name", name.to_owned());
            }
            if let Some(entry) = entry {
                form = form.text("entry", entry.to_owned());
            }
            let endpoint = artifact_id.map_or_else(
                || "/api/artifacts".to_owned(),
                |id| format!("/api/artifacts/{id}/upload-sessions"),
            );
            let sent = self
                .request(reqwest::Method::POST, &endpoint)
                .bearer_auth(token)
                .header("Idempotency-Key", &idempotency_key)
                .multipart(form.part("file", file))
                .send()
                .await;
            match sent {
                Ok(value) if value.status().is_success() => {
                    response = Some(value);
                    break;
                }
                Ok(value) => {
                    let fallback_delay = std::time::Duration::from_millis(
                        250 * u64::try_from(attempt + 1).unwrap_or(10),
                    )
                    .min(std::time::Duration::from_secs(2));
                    let (error, retry_delay) = Self::upload_error(value, fallback_delay).await;
                    let Some(retry_delay) = retry_delay else {
                        return Err(error);
                    };
                    acceptance_uncertain = true;
                    if attempt < 9 {
                        tokio::time::sleep(retry_delay).await;
                    }
                }
                Err(_) => {
                    acceptance_uncertain = true;
                    if attempt < 9 {
                        let delay = std::time::Duration::from_millis(
                            250 * u64::try_from(attempt + 1).unwrap_or(10),
                        )
                        .min(std::time::Duration::from_secs(2));
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }
        let response = response.ok_or(if acceptance_uncertain {
            ArtifactError::UploadConfirmationPending
        } else {
            ArtifactError::Server
        })?;
        response.json().await.map_err(|_| ArtifactError::Server)
    }

    /// Reads the current processing state for an owned Artifact.
    ///
    /// # Errors
    /// Returns an Artifact error for authentication, transport, or response failures.
    pub async fn artifact_state(
        &self,
        token: &str,
        id: &str,
    ) -> Result<ArtifactState, ArtifactError> {
        #[derive(Deserialize)]
        struct Body {
            artifact: ArtifactState,
        }
        let response = self
            .request(reqwest::Method::GET, &format!("/api/artifacts/{id}"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| ArtifactError::Network(e.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::artifact_error(response).await);
        }
        response
            .json::<Body>()
            .await
            .map(|v| v.artifact)
            .map_err(|_| ArtifactError::Server)
    }
}

fn retry_after_seconds(response: &Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

#[async_trait]
impl AuthApi for ApiClient {
    async fn current_user(&self, token: &str) -> Result<User, AuthError> {
        #[derive(Deserialize)]
        struct UserResponse {
            user: User,
        }
        let response = self
            .send(
                self.request(reqwest::Method::GET, "/api/users/me")
                    .bearer_auth(token),
            )
            .await?;
        if !response.status().is_success() {
            return Err(Self::error(response).await);
        }
        response
            .json::<UserResponse>()
            .await
            .map(|value| value.user)
            .map_err(|_| AuthError::Server)
    }

    async fn start_authorization(&self) -> Result<Authorization, AuthError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            authorization: AuthorizationBody,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AuthorizationBody {
            device_code: String,
            user_code: String,
            verification_uri: String,
            verification_uri_complete: String,
            expires_in: u64,
            interval: u64,
        }
        let response = self
            .send(
                self.request(reqwest::Method::POST, "/api/cli-authorizations")
                    .json(&serde_json::json!({ "clientId": CLIENT_ID })),
            )
            .await?;
        if !response.status().is_success() {
            return Err(Self::error(response).await);
        }
        let value = response
            .json::<Body>()
            .await
            .map_err(|_| AuthError::Server)?
            .authorization;
        Ok(Authorization {
            device_code: value.device_code,
            user_code: value.user_code,
            verification_uri: value.verification_uri,
            verification_uri_complete: value.verification_uri_complete,
            expires_in: value.expires_in,
            interval: value.interval,
        })
    }

    async fn exchange(&self, device_code: &str) -> Result<Exchange, AuthError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            session: Session,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Session {
            access_token: String,
        }
        let response = self
            .send(
                self.request(reqwest::Method::POST, "/api/cli-sessions")
                    .json(&serde_json::json!({ "clientId": CLIENT_ID, "deviceCode": device_code })),
            )
            .await?;
        if !response.status().is_success() {
            return Err(Self::error(response).await);
        }
        let token = response
            .json::<Body>()
            .await
            .map_err(|_| AuthError::Server)?
            .session
            .access_token;
        let user = match self.current_user(&token).await {
            Ok(user) => user,
            Err(error) => {
                let _ = self.revoke(&token).await;
                return Err(error);
            }
        };
        Ok(Exchange {
            access_token: token,
            user,
        })
    }

    async fn revoke(&self, token: &str) -> Result<(), AuthError> {
        let response = self
            .send(
                self.request(reqwest::Method::DELETE, "/api/cli-sessions/current")
                    .bearer_auth(token),
            )
            .await?;
        if response.status().is_success() || response.status() == StatusCode::UNAUTHORIZED {
            return Ok(());
        }
        Err(Self::error(response).await)
    }
}
