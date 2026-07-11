use crate::{AuthError, CredentialStore};

pub struct KeyringCredentialStore {
    entry: keyring::Entry,
}

impl KeyringCredentialStore {
    /// Creates an origin-scoped operating-system credential-store adapter.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when the platform store cannot create an entry.
    pub fn new(api_origin: &str) -> Result<Self, AuthError> {
        let parsed = url::Url::parse(api_origin).map_err(|_| AuthError::InvalidApiUrl)?;
        let normalized_origin = parsed.origin().ascii_serialization();
        let entry = keyring::Entry::new("shareslices-cli", &normalized_origin)
            .map_err(|error| AuthError::CredentialStore(error.to_string()))?;
        Ok(Self { entry })
    }
}

impl CredentialStore for KeyringCredentialStore {
    fn get(&self) -> Result<Option<String>, AuthError> {
        match self.entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AuthError::CredentialStore(error.to_string())),
        }
    }

    fn set(&self, value: &str) -> Result<(), AuthError> {
        self.entry
            .set_password(value)
            .map_err(|error| AuthError::CredentialStore(error.to_string()))
    }

    fn delete(&self) -> Result<(), AuthError> {
        match self.entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AuthError::CredentialStore(error.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring::mock::MockCredential;
    use std::io;

    #[test]
    fn maps_missing_lifecycle_locked_and_unavailable_store_states() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let store = KeyringCredentialStore::new("https://example.test").unwrap();
        let mock = store
            .entry
            .get_credential()
            .downcast_ref::<MockCredential>()
            .unwrap();

        assert_eq!(store.get().unwrap(), None);
        store.set("secret").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("secret"));
        store.delete().unwrap();
        assert_eq!(store.get().unwrap(), None);

        mock.set_error(keyring::Error::NoStorageAccess(Box::new(io::Error::other(
            "locked",
        ))));
        assert!(
            matches!(store.get(), Err(AuthError::CredentialStore(message)) if message.contains("locked"))
        );
        mock.set_error(keyring::Error::PlatformFailure(Box::new(io::Error::other(
            "unavailable",
        ))));
        assert!(
            matches!(store.set("secret"), Err(AuthError::CredentialStore(message)) if message.contains("unavailable"))
        );
    }
}
