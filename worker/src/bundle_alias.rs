use std::sync::Arc;

use tokio::io::AsyncReadExt;

use crate::{
    content_fingerprint::FingerprintKey,
    job_store::{ContentBundleIntegrity, ContentBundleStore, PostgresJobStore},
    logging::{SanitizedException, Severity, WorkerEvent},
    manifest::ReadyManifest,
    object_storage::{AwsS3ObjectStorage, ObjectStorage},
    runner::{BackgroundLane, ClaimPermit, LaneRunOutcome, RunnerError, RunnerLane},
};

const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;

pub struct BundleAliasLane {
    store: Arc<PostgresJobStore>,
    storage: AwsS3ObjectStorage,
    current_key: FingerprintKey,
}

#[derive(Clone, Copy, Debug, Default)]
struct AliasBatchOutcome {
    changed: u64,
    reindexed: u64,
}

impl BundleAliasLane {
    #[must_use]
    pub const fn new(
        store: Arc<PostgresJobStore>,
        storage: AwsS3ObjectStorage,
        current_key: FingerprintKey,
    ) -> Self {
        Self {
            store,
            storage,
            current_key,
        }
    }

    async fn run_batch(&self) -> LaneRunOutcome {
        match reindex_bundle_aliases(&self.store, &self.storage, &self.current_key, 1).await {
            Ok(outcome) if outcome.changed > 0 => {
                if outcome.reindexed > 0 {
                    tracing::info!(
                        event_name = "shareslices.artifact.bundle_alias.reindexed",
                        shareslices.bundle_alias.reindexed_count = outcome.reindexed,
                        "Content bundle aliases reindexed"
                    );
                }
                LaneRunOutcome::Claimed
            }
            Ok(_) => LaneRunOutcome::Idle,
            Err(error) => {
                WorkerEvent::new(
                    Severity::Error,
                    "shareslices.artifact.bundle_alias.reindex_failed",
                    "Content bundle alias reindex failed",
                )
                .with_exception(SanitizedException::new(
                    std::any::type_name_of_val(&*error),
                    error.to_string(),
                    Option::<&str>::None,
                    std::iter::empty::<&str>(),
                ))
                .emit();
                LaneRunOutcome::Idle
            }
        }
    }
}

#[async_trait::async_trait(?Send)]
impl BackgroundLane for BundleAliasLane {
    fn lane(&self) -> RunnerLane {
        RunnerLane::BundleAlias
    }

    async fn run_one(&self, _permit: ClaimPermit) -> Result<LaneRunOutcome, RunnerError> {
        Ok(self.run_batch().await)
    }

    async fn has_claimable_work(&self) -> Result<bool, RunnerError> {
        self.store
            .list_bundle_alias_reindex_candidates(&self.current_key.revision, 1)
            .await
            .map(|candidates| !candidates.is_empty())
            .map_err(|_| RunnerError::Lane("bundle-alias work observation failed".to_owned()))
    }
}

async fn reindex_bundle_aliases(
    store: &PostgresJobStore,
    storage: &dyn ObjectStorage,
    current_key: &FingerprintKey,
    limit: i64,
) -> Result<AliasBatchOutcome, Box<dyn std::error::Error + Send + Sync>> {
    let candidates = store
        .list_bundle_alias_reindex_candidates(&current_key.revision, limit)
        .await?;
    let mut outcome = AliasBatchOutcome::default();
    for candidate in candidates {
        let Some(manifest_object_key) = candidate.manifest_object_key.as_deref() else {
            outcome.changed += u64::from(
                store
                    .quarantine_content_bundle(
                        &candidate.bundle_id,
                        ContentBundleIntegrity::Suspect,
                    )
                    .await?,
            );
            continue;
        };
        let mut bytes = Vec::new();
        storage
            .read_private_object(manifest_object_key)
            .await?
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)
            .await?;
        let manifest = if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_MANIFEST_BYTES {
            None
        } else {
            serde_json::from_slice::<ReadyManifest>(&bytes).ok()
        };
        let Some(manifest) = manifest else {
            outcome.changed += u64::from(
                store
                    .quarantine_content_bundle(
                        &candidate.bundle_id,
                        ContentBundleIntegrity::Suspect,
                    )
                    .await?,
            );
            continue;
        };
        let Ok(identity) = manifest.content_identity(&candidate.content_identity_revision) else {
            outcome.changed += u64::from(
                store
                    .quarantine_content_bundle(
                        &candidate.bundle_id,
                        ContentBundleIntegrity::Suspect,
                    )
                    .await?,
            );
            continue;
        };
        let alias = current_key.alias(&candidate.owner_user_id, identity.as_bytes());
        if store
            .install_reindexed_bundle_alias(&candidate, &alias.key_revision, &alias.value)
            .await?
        {
            outcome.changed += 1;
            outcome.reindexed += 1;
        }
    }
    Ok(outcome)
}
