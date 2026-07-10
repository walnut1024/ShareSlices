use std::{collections::HashMap, io, pin::Pin, sync::Arc};

use async_trait::async_trait;
use aws_sdk_s3::{
    Client,
    primitives::{ByteStream, SdkBody},
};
use futures_util::TryStreamExt;
use http_body::Frame;
use http_body_util::StreamBody;
use thiserror::Error;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::RwLock,
};
use tokio_util::io::ReaderStream;

pub type ObjectReader = Pin<Box<dyn AsyncRead + Send + Sync>>;

#[derive(Debug, Error)]
pub enum ObjectStorageError {
    #[error("failed to read object {key}: {message}")]
    Read { key: String, message: String },
    #[error("failed to write object {key}: {message}")]
    Write { key: String, message: String },
    #[error("failed to promote staging object {source_key} to {destination_key}: {message}")]
    Promote {
        source_key: String,
        destination_key: String,
        message: String,
    },
    #[error("failed to remove staging prefix {prefix}: {message}")]
    Cleanup { prefix: String, message: String },
    #[error("object {key} had {actual} bytes; expected {expected}")]
    LengthMismatch {
        key: String,
        expected: u64,
        actual: u64,
    },
}

#[async_trait]
pub trait ObjectStorage: Send + Sync {
    async fn read_raw_archive(&self, key: &str) -> Result<ObjectReader, ObjectStorageError>;

    async fn write_staging_object(
        &self,
        key: &str,
        content_length: u64,
        content_type: &str,
        body: ObjectReader,
    ) -> Result<(), ObjectStorageError>;

    async fn promote_staging_object(
        &self,
        source_key: &str,
        destination_key: &str,
        content_length: u64,
        content_type: &str,
    ) -> Result<(), ObjectStorageError>;

    async fn remove_staging_prefix(&self, prefix: &str) -> Result<u64, ObjectStorageError>;
}

#[derive(Clone)]
pub struct AwsS3ObjectStorage {
    client: Client,
    bucket: String,
}

impl AwsS3ObjectStorage {
    #[must_use]
    pub fn new(client: Client, bucket: impl Into<String>) -> Self {
        Self {
            client,
            bucket: bucket.into(),
        }
    }
}

#[async_trait]
impl ObjectStorage for AwsS3ObjectStorage {
    async fn read_raw_archive(&self, key: &str) -> Result<ObjectReader, ObjectStorageError> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| ObjectStorageError::Read {
                key: key.to_owned(),
                message: error.to_string(),
            })?;

        Ok(Box::pin(output.body.into_async_read()))
    }

    async fn write_staging_object(
        &self,
        key: &str,
        content_length: u64,
        content_type: &str,
        body: ObjectReader,
    ) -> Result<(), ObjectStorageError> {
        let stream = ReaderStream::new(body).map_ok(Frame::data);
        let sdk_body = SdkBody::from_body_1_x(StreamBody::new(stream));

        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_length(i64::try_from(content_length).map_err(|error| {
                ObjectStorageError::Write {
                    key: key.to_owned(),
                    message: error.to_string(),
                }
            })?)
            .content_type(content_type)
            .body(ByteStream::new(sdk_body))
            .send()
            .await
            .map_err(|error| ObjectStorageError::Write {
                key: key.to_owned(),
                message: error.to_string(),
            })?;

        Ok(())
    }

    async fn promote_staging_object(
        &self,
        source_key: &str,
        destination_key: &str,
        content_length: u64,
        content_type: &str,
    ) -> Result<(), ObjectStorageError> {
        let source = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(source_key)
            .send()
            .await
            .map_err(|error| ObjectStorageError::Promote {
                source_key: source_key.to_owned(),
                destination_key: destination_key.to_owned(),
                message: error.to_string(),
            })?;
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(destination_key)
            .content_length(i64::try_from(content_length).map_err(|error| {
                ObjectStorageError::Promote {
                    source_key: source_key.to_owned(),
                    destination_key: destination_key.to_owned(),
                    message: error.to_string(),
                }
            })?)
            .content_type(content_type)
            .body(source.body)
            .send()
            .await
            .map_err(|error| ObjectStorageError::Promote {
                source_key: source_key.to_owned(),
                destination_key: destination_key.to_owned(),
                message: error.to_string(),
            })?;
        Ok(())
    }

    async fn remove_staging_prefix(&self, prefix: &str) -> Result<u64, ObjectStorageError> {
        let mut continuation_token = None;
        let mut keys = Vec::new();
        loop {
            let output = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(prefix)
                .set_continuation_token(continuation_token)
                .send()
                .await
                .map_err(|error| ObjectStorageError::Cleanup {
                    prefix: prefix.to_owned(),
                    message: error.to_string(),
                })?;
            keys.extend(
                output
                    .contents()
                    .iter()
                    .filter_map(|object| object.key().map(ToOwned::to_owned)),
            );
            if !output.is_truncated().unwrap_or(false) {
                break;
            }
            continuation_token = output.next_continuation_token().map(ToOwned::to_owned);
        }

        for key in &keys {
            self.client
                .delete_object()
                .bucket(&self.bucket)
                .key(key)
                .send()
                .await
                .map_err(|error| ObjectStorageError::Cleanup {
                    prefix: prefix.to_owned(),
                    message: error.to_string(),
                })?;
        }
        Ok(u64::try_from(keys.len()).expect("object count always fits into u64"))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredObject {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

#[derive(Clone, Default)]
pub struct InMemoryObjectStorage {
    raw: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    staging: Arc<RwLock<HashMap<String, StoredObject>>>,
    committed: Arc<RwLock<HashMap<String, StoredObject>>>,
}

impl InMemoryObjectStorage {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn put_raw_for_test(&self, key: &str, bytes: Vec<u8>) {
        self.raw.write().await.insert(key.to_owned(), bytes);
    }

    pub async fn staging_bytes_for_test(&self, key: &str) -> Option<Vec<u8>> {
        self.staging
            .read()
            .await
            .get(key)
            .map(|object| object.bytes.clone())
    }

    pub async fn staging_object_for_test(&self, key: &str) -> Option<StoredObject> {
        self.staging.read().await.get(key).cloned()
    }

    pub async fn committed_object_for_test(&self, key: &str) -> Option<StoredObject> {
        self.committed.read().await.get(key).cloned()
    }
}

#[async_trait]
impl ObjectStorage for InMemoryObjectStorage {
    async fn read_raw_archive(&self, key: &str) -> Result<ObjectReader, ObjectStorageError> {
        let bytes =
            self.raw
                .read()
                .await
                .get(key)
                .cloned()
                .ok_or_else(|| ObjectStorageError::Read {
                    key: key.to_owned(),
                    message: "object not found".to_owned(),
                })?;
        Ok(Box::pin(io::Cursor::new(bytes)))
    }

    async fn write_staging_object(
        &self,
        key: &str,
        content_length: u64,
        content_type: &str,
        mut body: ObjectReader,
    ) -> Result<(), ObjectStorageError> {
        let mut bytes = Vec::new();
        body.read_to_end(&mut bytes)
            .await
            .map_err(|error| ObjectStorageError::Write {
                key: key.to_owned(),
                message: error.to_string(),
            })?;
        let actual = u64::try_from(bytes.len()).expect("usize always fits into u64");
        if actual != content_length {
            return Err(ObjectStorageError::LengthMismatch {
                key: key.to_owned(),
                expected: content_length,
                actual,
            });
        }
        self.staging.write().await.insert(
            key.to_owned(),
            StoredObject {
                bytes,
                content_type: content_type.to_owned(),
            },
        );
        Ok(())
    }

    async fn promote_staging_object(
        &self,
        source_key: &str,
        destination_key: &str,
        content_length: u64,
        content_type: &str,
    ) -> Result<(), ObjectStorageError> {
        let source = self
            .staging
            .read()
            .await
            .get(source_key)
            .cloned()
            .ok_or_else(|| ObjectStorageError::Promote {
                source_key: source_key.to_owned(),
                destination_key: destination_key.to_owned(),
                message: "object not found".to_owned(),
            })?;
        let actual = u64::try_from(source.bytes.len()).expect("usize always fits into u64");
        if actual != content_length {
            return Err(ObjectStorageError::LengthMismatch {
                key: source_key.to_owned(),
                expected: content_length,
                actual,
            });
        }
        self.committed.write().await.insert(
            destination_key.to_owned(),
            StoredObject {
                bytes: source.bytes,
                content_type: content_type.to_owned(),
            },
        );
        Ok(())
    }

    async fn remove_staging_prefix(&self, prefix: &str) -> Result<u64, ObjectStorageError> {
        let mut staging = self.staging.write().await;
        let before = staging.len();
        staging.retain(|key, _| !key.starts_with(prefix));
        Ok(u64::try_from(before - staging.len()).expect("object count always fits into u64"))
    }
}
