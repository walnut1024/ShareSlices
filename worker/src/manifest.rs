use serde::{Deserialize, Serialize};

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

    /// Serializes the path-sorted manifest to stable JSON bytes.
    ///
    /// # Errors
    ///
    /// Returns an error if serialization fails.
    pub fn to_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }
}
