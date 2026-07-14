use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write;
use thiserror::Error;

const CONTENT_IDENTITY_DOMAIN: &[u8] = b"shareslices.content_bundle.identity\0";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentIdentity([u8; 32]);

impl ContentIdentity {
    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    #[must_use]
    pub fn as_hex(&self) -> String {
        self.0.iter().fold(
            String::with_capacity(self.0.len() * 2),
            |mut output, byte| {
                write!(output, "{byte:02x}").expect("writing to a String cannot fail");
                output
            },
        )
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ContentIdentityError {
    #[error("content identity revision must not be empty")]
    EmptyRevision,
    #[error("manifest asset {path} has an invalid SHA-256 digest")]
    InvalidAssetDigest { path: String },
    #[error("content identity field is too large")]
    FieldTooLarge,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAsset {
    pub path: String,
    pub object_key: String,
    pub size_bytes: u64,
    pub content_type: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyManifest {
    pub entry_path: String,
    pub files: Vec<ManifestAsset>,
}

impl ReadyManifest {
    #[must_use]
    pub fn new(entry_path: String, mut files: Vec<ManifestAsset>) -> Self {
        files.sort_by(|left, right| left.path.cmp(&right.path));
        Self { entry_path, files }
    }

    #[must_use]
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    #[must_use]
    pub fn total_size_bytes(&self) -> u64 {
        self.files.iter().map(|file| file.size_bytes).sum()
    }

    /// Calculates the versioned identity of normalized Artifact content.
    ///
    /// Object keys are intentionally excluded. Each variable-length field is
    /// length-delimited so distinct paths and metadata cannot produce an
    /// ambiguous encoding.
    ///
    /// # Errors
    ///
    /// Returns an error for an empty revision, an invalid asset digest, or a
    /// field whose length cannot be represented by the canonical encoding.
    pub fn content_identity(
        &self,
        revision: &str,
    ) -> Result<ContentIdentity, ContentIdentityError> {
        if revision.is_empty() {
            return Err(ContentIdentityError::EmptyRevision);
        }

        let mut canonical = Vec::new();
        canonical.extend_from_slice(CONTENT_IDENTITY_DOMAIN);
        push_field(&mut canonical, revision.as_bytes())?;
        push_field(&mut canonical, self.entry_path.as_bytes())?;
        let mut assets = self.files.iter().collect::<Vec<_>>();
        assets.sort_by(|left, right| left.path.cmp(&right.path));
        canonical.extend_from_slice(
            &u64::try_from(assets.len())
                .map_err(|_| ContentIdentityError::FieldTooLarge)?
                .to_be_bytes(),
        );
        for asset in assets {
            push_field(&mut canonical, asset.path.as_bytes())?;
            canonical.extend_from_slice(&asset.size_bytes.to_be_bytes());
            push_field(&mut canonical, asset.content_type.as_bytes())?;
            canonical.extend_from_slice(&decode_sha256(&asset.path, &asset.sha256)?);
        }

        Ok(ContentIdentity(Sha256::digest(canonical).into()))
    }

    /// Serializes the path-sorted manifest to stable JSON bytes.
    ///
    /// # Errors
    ///
    /// Returns an error if serialization fails.
    pub fn to_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }
}

fn push_field(output: &mut Vec<u8>, value: &[u8]) -> Result<(), ContentIdentityError> {
    let length = u64::try_from(value.len()).map_err(|_| ContentIdentityError::FieldTooLarge)?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value);
    Ok(())
}

fn decode_sha256(path: &str, digest: &str) -> Result<[u8; 32], ContentIdentityError> {
    if digest.len() != 64 {
        return Err(ContentIdentityError::InvalidAssetDigest {
            path: path.to_owned(),
        });
    }
    let mut bytes = [0; 32];
    for (index, pair) in digest.as_bytes().chunks_exact(2).enumerate() {
        let text =
            std::str::from_utf8(pair).map_err(|_| ContentIdentityError::InvalidAssetDigest {
                path: path.to_owned(),
            })?;
        bytes[index] =
            u8::from_str_radix(text, 16).map_err(|_| ContentIdentityError::InvalidAssetDigest {
                path: path.to_owned(),
            })?;
    }
    Ok(bytes)
}
