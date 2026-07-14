use hmac::{Hmac, Mac};
use sha2::Sha256;
use thiserror::Error;

const DOMAIN: &[u8] = b"shareslices/content-bundle-fingerprint/v1\0";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FingerprintKey {
    pub revision: String,
    secret: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FingerprintAlias {
    pub key_revision: String,
    pub value: String,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum FingerprintError {
    #[error("fingerprint key revision cannot be empty")]
    EmptyRevision,
    #[error("fingerprint key must contain at least 32 bytes")]
    WeakKey,
}

impl FingerprintKey {
    /// Builds a private fingerprint key.
    ///
    /// # Errors
    ///
    /// Returns an error when the revision is empty or the secret is shorter than 32 bytes.
    pub fn new(
        revision: impl Into<String>,
        secret: impl Into<Vec<u8>>,
    ) -> Result<Self, FingerprintError> {
        let revision = revision.into();
        let secret = secret.into();
        if revision.is_empty() {
            return Err(FingerprintError::EmptyRevision);
        }
        if secret.len() < 32 {
            return Err(FingerprintError::WeakKey);
        }
        Ok(Self { revision, secret })
    }

    /// Computes the private alias for canonical identity bytes.
    ///
    /// # Panics
    ///
    /// HMAC-SHA-256 accepts keys of every size, so initialization cannot fail.
    #[must_use]
    pub fn alias(&self, owner_user_id: &str, canonical_identity: &[u8]) -> FingerprintAlias {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.secret).expect("HMAC accepts any key size");
        mac.update(DOMAIN);
        mac.update(owner_user_id.as_bytes());
        mac.update(b"\0");
        mac.update(canonical_identity);
        let bytes = mac.finalize().into_bytes();
        FingerprintAlias {
            key_revision: self.revision.clone(),
            value: hex(&bytes),
        }
    }
}

#[must_use]
pub fn aliases(
    current: &FingerprintKey,
    previous: Option<&FingerprintKey>,
    owner_user_id: &str,
    canonical_identity: &[u8],
) -> Vec<FingerprintAlias> {
    std::iter::once(current.alias(owner_user_id, canonical_identity))
        .chain(previous.map(|key| key.alias(owner_user_id, canonical_identity)))
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(
        String::with_capacity(bytes.len() * 2),
        |mut output, byte| {
            write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
            output
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{FingerprintError, FingerprintKey, aliases};

    #[test]
    fn produces_domain_separated_current_and_previous_aliases() {
        let current =
            FingerprintKey::new("key-v2", b"current-secret-with-at-least-32-bytes".to_vec())
                .unwrap();
        let previous =
            FingerprintKey::new("key-v1", b"previous-secret-with-at-least-32-bytes".to_vec())
                .unwrap();

        let values = aliases(&current, Some(&previous), "owner-1", b"canonical-identity");

        assert_eq!(values.len(), 2);
        assert_eq!(values[0].key_revision, "key-v2");
        assert_eq!(values[0].value.len(), 64);
        assert_ne!(values[0].value, values[1].value);
        assert_eq!(
            values,
            aliases(&current, Some(&previous), "owner-1", b"canonical-identity")
        );
        assert_ne!(
            values[0].value,
            aliases(&current, None, "owner-2", b"canonical-identity")[0].value
        );
    }

    #[test]
    fn rejects_missing_revision_and_weak_keys() {
        assert_eq!(
            FingerprintKey::new("", vec![b'a'; 32]),
            Err(FingerprintError::EmptyRevision)
        );
        assert_eq!(
            FingerprintKey::new("v1", vec![b'a'; 31]),
            Err(FingerprintError::WeakKey)
        );
    }
}
