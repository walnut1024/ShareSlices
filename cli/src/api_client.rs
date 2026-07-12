use crate::{
    Artifact, ArtifactError, AuthApi, AuthError, Authorization, Exchange, ProcessingFilter,
    PublicationFilter, User,
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
    details: Option<CompatibilityDetails>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompatibilityDetails {
    current_version: Option<String>,
    minimum_version: Option<String>,
}

impl ApiClient {
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

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, self.base_url.join(path).expect("fixed API path"))
            .header("ShareSlices-CLI-Version", env!("CARGO_PKG_VERSION"))
            .header("ShareSlices-CLI-OS", std::env::consts::OS)
    }

    async fn error(response: Response) -> AuthError {
        if response.status() == StatusCode::UNAUTHORIZED {
            return AuthError::Unauthenticated;
        }
        let body = response.json::<ErrorEnvelope>().await.ok();
        match body.as_ref().map(|value| value.error.code.as_str()) {
            Some("authorization_pending") => AuthError::Pending,
            Some("slow_down") => AuthError::SlowDown,
            Some("expired_token" | "invalid_grant") => AuthError::Expired,
            Some("access_denied") => AuthError::Denied,
            Some("cli_upgrade_required") => {
                let details = body.and_then(|value| value.error.details);
                AuthError::UpgradeRequired {
                    current: details
                        .as_ref()
                        .and_then(|value| value.current_version.clone())
                        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_owned()),
                    minimum: details
                        .and_then(|value| value.minimum_version)
                        .unwrap_or_else(|| "a newer version".to_owned()),
                }
            }
            _ => AuthError::Server,
        }
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<Response, AuthError> {
        request
            .send()
            .await
            .map_err(|error| AuthError::Network(error.to_string()))
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
            if response.status() == StatusCode::UNAUTHORIZED {
                return Err(ArtifactError::Unauthenticated);
            }
            if !response.status().is_success() {
                return Err(ArtifactError::Server);
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
