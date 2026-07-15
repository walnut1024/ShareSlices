use crate::{AuthError, Authorization};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CONTINUATION_RECORD_VERSION: u32 = 1;
const RETENTION_SECONDS: u64 = 3_600;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthContinuationRecord {
    pub version: u32,
    pub id: String,
    pub api_origin: String,
    pub device_code: Option<String>,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub verification_uri_complete: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub check_after: u64,
    pub interval_seconds: u64,
    pub terminal: bool,
    pub delete_after: u64,
}

impl AuthContinuationRecord {
    #[must_use]
    pub fn new(api_origin: String, authorization: Authorization) -> Self {
        let now = unix_now();
        let expires_at = now.saturating_add(authorization.expires_in);
        Self {
            version: CONTINUATION_RECORD_VERSION,
            id: uuid::Uuid::new_v4().to_string(),
            api_origin,
            device_code: Some(authorization.device_code),
            user_code: Some(authorization.user_code),
            verification_uri: Some(authorization.verification_uri),
            verification_uri_complete: Some(authorization.verification_uri_complete),
            created_at: now,
            expires_at,
            check_after: now.saturating_add(authorization.interval),
            interval_seconds: authorization.interval,
            terminal: false,
            delete_after: expires_at.saturating_add(RETENTION_SECONDS),
        }
    }

    pub fn strip_terminal_secrets(&mut self) {
        self.device_code = None;
        self.user_code = None;
        self.verification_uri = None;
        self.verification_uri_complete = None;
        self.terminal = true;
    }
}

#[allow(clippy::missing_errors_doc)]
pub trait AuthContinuationStore: Send + Sync {
    fn active_for_origin(&self, origin: &str) -> Result<Option<AuthContinuationRecord>, AuthError>;
    fn read(&self, id: &str) -> Result<Option<AuthContinuationRecord>, AuthError>;
    fn write(&self, record: &AuthContinuationRecord) -> Result<(), AuthError>;
    fn claim(&self, id: &str) -> Result<bool, AuthError>;
    fn release_claim(&self, id: &str) -> Result<(), AuthError>;
}

#[derive(Default)]
pub struct MemoryAuthContinuationStore {
    records: Mutex<HashMap<String, AuthContinuationRecord>>,
    claims: Mutex<HashSet<String>>,
}

impl AuthContinuationStore for MemoryAuthContinuationStore {
    fn active_for_origin(&self, origin: &str) -> Result<Option<AuthContinuationRecord>, AuthError> {
        Ok(self
            .records
            .lock()
            .expect("records")
            .values()
            .find(|record| {
                record.api_origin == origin && !record.terminal && record.expires_at > unix_now()
            })
            .cloned())
    }
    fn read(&self, id: &str) -> Result<Option<AuthContinuationRecord>, AuthError> {
        Ok(self.records.lock().expect("records").get(id).cloned())
    }
    fn write(&self, record: &AuthContinuationRecord) -> Result<(), AuthError> {
        self.records
            .lock()
            .expect("records")
            .insert(record.id.clone(), record.clone());
        Ok(())
    }
    fn claim(&self, id: &str) -> Result<bool, AuthError> {
        Ok(self.claims.lock().expect("claims").insert(id.to_owned()))
    }
    fn release_claim(&self, id: &str) -> Result<(), AuthError> {
        self.claims.lock().expect("claims").remove(id);
        Ok(())
    }
}

pub struct FileAuthContinuationStore {
    directory: PathBuf,
}

impl FileAuthContinuationStore {
    /// Creates the private continuation adapter and returns its normalized API origin.
    ///
    /// # Errors
    /// Returns an authentication error when the URL or private state directory is unavailable.
    pub fn for_origin(api_url: &str) -> Result<(String, Self), AuthError> {
        let origin = normalized_origin(api_url)?;
        let directory = state_root()?.join("auth-continuations");
        fs::create_dir_all(&directory).map_err(store_error)?;
        set_private_directory(&directory)?;
        Ok((origin, Self { directory }))
    }
    fn record_path(&self, id: &str) -> PathBuf {
        self.directory.join(format!("{id}.json"))
    }
    fn claim_path(&self, id: &str) -> PathBuf {
        self.directory.join(format!("{id}.claim"))
    }
    fn cleanup(&self) -> Result<(), AuthError> {
        let now = unix_now();
        for entry in fs::read_dir(&self.directory).map_err(store_error)? {
            let path = entry.map_err(store_error)?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(bytes) = fs::read(&path)
                && let Ok(record) = serde_json::from_slice::<AuthContinuationRecord>(&bytes)
                && record.delete_after <= now
            {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }
}

impl AuthContinuationStore for FileAuthContinuationStore {
    fn active_for_origin(&self, origin: &str) -> Result<Option<AuthContinuationRecord>, AuthError> {
        self.cleanup()?;
        for entry in fs::read_dir(&self.directory).map_err(store_error)? {
            let path = entry.map_err(store_error)?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let record: AuthContinuationRecord =
                serde_json::from_slice(&fs::read(path).map_err(store_error)?)
                    .map_err(store_error)?;
            if record.api_origin == origin && !record.terminal && record.expires_at > unix_now() {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }
    fn read(&self, id: &str) -> Result<Option<AuthContinuationRecord>, AuthError> {
        match fs::read(self.record_path(id)) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(store_error),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(store_error(error)),
        }
    }
    fn write(&self, record: &AuthContinuationRecord) -> Result<(), AuthError> {
        let temporary = self
            .directory
            .join(format!(".{}.{}.tmp", record.id, uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(record).map_err(store_error)?;
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(store_error)?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(store_error)?;
        fs::rename(&temporary, self.record_path(&record.id)).map_err(store_error)
    }
    fn claim(&self, id: &str) -> Result<bool, AuthError> {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        match options.open(self.claim_path(id)) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(error) => Err(store_error(error)),
        }
    }
    fn release_claim(&self, id: &str) -> Result<(), AuthError> {
        match fs::remove_file(self.claim_path(id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(store_error(error)),
        }
    }
}

/// Normalizes the API URL to the origin used for credential and continuation isolation.
///
/// # Errors
/// Returns [`AuthError::InvalidApiUrl`] for a URL without a valid origin.
pub fn normalized_origin(api_url: &str) -> Result<String, AuthError> {
    let url = url::Url::parse(api_url).map_err(|_| AuthError::InvalidApiUrl)?;
    let host = url.host_str().ok_or(AuthError::InvalidApiUrl)?;
    let port = url
        .port()
        .map_or_else(String::new, |value| format!(":{value}"));
    Ok(format!(
        "{}://{}{}",
        url.scheme().to_ascii_lowercase(),
        host.to_ascii_lowercase(),
        port
    ))
}

#[must_use]
pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[must_use]
pub fn format_timestamp(value: u64) -> String {
    time::OffsetDateTime::from_unix_timestamp(i64::try_from(value).unwrap_or(i64::MAX))
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn state_root() -> Result<PathBuf, AuthError> {
    if let Some(path) = std::env::var_os("SHARESLICES_STATE_DIR") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| path.join("Library/Application Support/ShareSlices"))
            .ok_or_else(|| AuthError::CredentialStore("state directory unavailable".to_owned()))
    }
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("ShareSlices"))
            .ok_or_else(|| AuthError::CredentialStore("state directory unavailable".to_owned()));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return Ok(std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|path| path.join(".local/state"))
            })
            .ok_or_else(|| AuthError::CredentialStore("state directory unavailable".to_owned()))?
            .join("shareslices"));
    }
}

fn store_error(error: impl std::fmt::Display) -> AuthError {
    AuthError::CredentialStore(error.to_string())
}

fn set_private_directory(path: &Path) -> Result<(), AuthError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(store_error)?;
    }
    Ok(())
}
