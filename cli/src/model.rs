use async_trait::async_trait;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct User {
    pub name: String,
    pub email: String,
}

#[derive(Clone, Debug)]
pub struct Authorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Clone, Debug)]
pub struct Exchange {
    pub access_token: String,
    pub user: User,
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Not signed in.")]
    Unauthenticated,
    #[error("Authorization is still pending.")]
    Pending,
    #[error("Polling too quickly.")]
    SlowDown,
    #[error("Authorization expired. Run shareslices auth login again.")]
    Expired,
    #[error("Authorization denied.")]
    Denied,
    #[error("Update ShareSlices CLI before continuing.\nCurrent: {current}\nMinimum: {minimum}")]
    UpgradeRequired { current: String, minimum: String },
    #[error("Could not reach ShareSlices: {0}")]
    Network(String),
    #[error("ShareSlices returned an unexpected response.")]
    Server,
    #[error("The operating system credential store is unavailable: {0}")]
    CredentialStore(String),
    #[error("Invalid ShareSlices API URL.")]
    InvalidApiUrl,
}

pub trait CredentialStore: Send + Sync {
    /// Reads the credential for the selected API origin.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when the operating-system store cannot be read.
    fn get(&self) -> Result<Option<String>, AuthError>;
    /// Stores the credential for the selected API origin.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when secure storage fails.
    fn set(&self, value: &str) -> Result<(), AuthError>;
    /// Removes the credential for the selected API origin.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when secure deletion fails.
    fn delete(&self) -> Result<(), AuthError>;
}

#[async_trait]
pub trait AuthApi: Send + Sync {
    async fn current_user(&self, token: &str) -> Result<User, AuthError>;
    async fn start_authorization(&self) -> Result<Authorization, AuthError>;
    async fn exchange(&self, device_code: &str) -> Result<Exchange, AuthError>;
    async fn revoke(&self, token: &str) -> Result<(), AuthError>;
}
