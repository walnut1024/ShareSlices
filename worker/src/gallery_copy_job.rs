use crate::{manifest::ReadyManifest, object_storage::ObjectStorage};
use sqlx::{PgPool, Row};
use std::{sync::Arc, time::Duration};
use tokio::io::AsyncReadExt;
use uuid::Uuid;
struct Claim {
    id: String,
    owner: String,
    source_listing: String,
    source_revision: i64,
    source_version: String,
    artifact: String,
    version: String,
    title: String,
    reservation: String,
    fence: i64,
    attempt: i32,
    bundle: String,
    source_manifest: String,
    content_revision: String,
    renderer: String,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopySourceEvent {
    Updated,
    CreatorWithdrawal,
    ArtifactDeleted,
    DistinctSourceAccountDeleted,
    AdministratorRemoval,
    Takedown,
    Restriction,
    GalleryUnavailable,
    CopierAccountDeleted,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopyLifecycleAction {
    ContinueFixedSnapshot,
    CancelBeforeReady,
}
#[must_use]
pub fn copy_lifecycle_action(event: CopySourceEvent) -> CopyLifecycleAction {
    match event {
        CopySourceEvent::Updated
        | CopySourceEvent::CreatorWithdrawal
        | CopySourceEvent::ArtifactDeleted
        | CopySourceEvent::DistinctSourceAccountDeleted => {
            CopyLifecycleAction::ContinueFixedSnapshot
        }
        CopySourceEvent::AdministratorRemoval
        | CopySourceEvent::Takedown
        | CopySourceEvent::Restriction
        | CopySourceEvent::GalleryUnavailable
        | CopySourceEvent::CopierAccountDeleted => CopyLifecycleAction::CancelBeforeReady,
    }
}
#[must_use]
pub fn should_retry(code: &str, attempt: i32, max_attempts: i32) -> bool {
    code != "invalid_input" && attempt < max_attempts
}
pub async fn run_gallery_copy_loop<S: ObjectStorage + 'static>(
    pool: PgPool,
    storage: Arc<S>,
    worker: String,
    lease: Duration,
    poll_interval: Duration,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    recover(&pool).await.ok();
    loop {
        if *shutdown.borrow() {
            return;
        }
        match claim(&pool, &worker, lease).await {
            Ok(Some(job)) => process(&pool, storage.as_ref(), &worker, lease, job).await,
            Ok(None) => {
                tokio::select! {()=tokio::time::sleep(poll_interval)=>{},_=shutdown.changed()=>{}}
            }
            Err(error) => {
                tracing::error!(
                    event_name = "shareslices.gallery.copy.claim_failed",
                    error.kind = "database",
                    "Gallery copy claim failed: {error}"
                );
                tokio::time::sleep(poll_interval).await;
            }
        }
    }
}
async fn claim(pool: &PgPool, worker: &str, lease: Duration) -> Result<Option<Claim>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let row=sqlx::query("select job.*,manifest.object_key source_manifest,bundle.content_identity_revision,version.renderer_revision from gallery_copy_job job join artifact_version version on version.id=job.source_version_id join content_bundle bundle on bundle.id=version.content_bundle_id join content_bundle_manifest manifest on manifest.bundle_id=bundle.id where job.state='accepted' order by job.accepted_at for update of job skip locked limit 1").fetch_optional(&mut*tx).await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let id: String = row.get("id");
    let updated=sqlx::query("update gallery_copy_job set state='processing',started_at=coalesce(started_at,now()),lease_owner=$2,lease_expires_at=now()+make_interval(secs=>$3),fence_token=fence_token+1,attempt_count=attempt_count+1 where id=$1 returning fence_token,attempt_count").bind(&id).bind(worker).bind(i32::try_from(lease.as_secs()).unwrap_or(i32::MAX)).fetch_one(&mut*tx).await?;
    let fence = updated.get("fence_token");
    let attempt = updated.get("attempt_count");
    let bundle = format!("copy-bundle-{}", Uuid::new_v4());
    sqlx::query("insert into gallery_copy_attempt(id,job_id,attempt_number,fence_token,object_prefix) values($1,$2,$3,$4,$5)").bind(format!("copy-attempt-{}",Uuid::new_v4())).bind(&id).bind(attempt).bind(fence).bind(format!("staging/gallery-copy/{id}/{fence}/")).execute(&mut*tx).await?;
    let claim = Claim {
        id,
        owner: row.get("copier_user_id"),
        source_listing: row.get("source_listing_id"),
        source_revision: row.get("source_listing_revision"),
        source_version: row.get("source_version_id"),
        artifact: row.get("destination_artifact_id"),
        version: row.get("destination_version_id"),
        title: row.get("destination_title"),
        reservation: row.get("quota_reservation_id"),
        fence,
        attempt,
        bundle,
        source_manifest: row.get("source_manifest"),
        content_revision: row.get("content_identity_revision"),
        renderer: row.get("renderer_revision"),
    };
    tx.commit().await?;
    Ok(Some(claim))
}
async fn process<S: ObjectStorage>(
    pool: &PgPool,
    storage: &S,
    worker: &str,
    lease: Duration,
    job: Claim,
) {
    let result = copy_objects(pool, storage, worker, lease, &job).await;
    if let Err(code) = result {
        let _ = fail(pool, storage, worker, &job, code).await;
    }
}
async fn copy_objects<S: ObjectStorage>(
    pool: &PgPool,
    storage: &S,
    worker: &str,
    lease: Duration,
    job: &Claim,
) -> Result<(), &'static str> {
    let reader = storage
        .read_private_object(&job.source_manifest)
        .await
        .map_err(|_| "source_unavailable")?;
    let mut bytes = Vec::new();
    reader
        .take(4 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "source_unavailable")?;
    let mut manifest: ReadyManifest =
        serde_json::from_slice(&bytes).map_err(|_| "invalid_input")?;
    for asset in &mut manifest.files {
        heartbeat(pool, worker, job, lease)
            .await
            .map_err(|_| "lease_lost")?;
        let source = storage
            .read_private_object(&asset.object_key)
            .await
            .map_err(|_| "source_unavailable")?;
        let staging = format!(
            "staging/gallery-copy/{}/{}/{}",
            job.id, job.fence, asset.path
        );
        let destination = format!("content-bundles/{}/{}", job.bundle, asset.path);
        storage
            .write_staging_object(&staging, asset.size_bytes, &asset.content_type, source)
            .await
            .map_err(|_| "write_failed")?;
        storage
            .promote_staging_object(
                &staging,
                &destination,
                asset.size_bytes,
                &asset.content_type,
            )
            .await
            .map_err(|_| "write_failed")?;
        asset.object_key = destination;
    }
    let manifest_bytes = manifest.to_json().map_err(|_| "invalid_input")?;
    let manifest_staging = format!(
        "staging/gallery-copy/{}/{}/manifest.json",
        job.id, job.fence
    );
    let manifest_key = format!("content-bundles/{}/manifest.json", job.bundle);
    storage
        .write_staging_object(
            &manifest_staging,
            manifest_bytes.len() as u64,
            "application/json",
            Box::pin(std::io::Cursor::new(manifest_bytes)),
        )
        .await
        .map_err(|_| "write_failed")?;
    storage
        .promote_staging_object(
            &manifest_staging,
            &manifest_key,
            manifest.to_json().map_err(|_| "invalid_input")?.len() as u64,
            "application/json",
        )
        .await
        .map_err(|_| "write_failed")?;
    let committed = commit(pool, worker, job, &manifest, &manifest_key)
        .await
        .map_err(|_| "commit_failed")?;
    if !committed {
        let _ = storage
            .remove_staging_prefix(&format!("content-bundles/{}/", job.bundle))
            .await;
    }
    Ok(())
}
async fn heartbeat(
    pool: &PgPool,
    worker: &str,
    job: &Claim,
    lease: Duration,
) -> Result<(), sqlx::Error> {
    let result=sqlx::query("update gallery_copy_job set lease_expires_at=now()+make_interval(secs=>$4) where id=$1 and state='processing' and lease_owner=$2 and fence_token=$3").bind(&job.id).bind(worker).bind(job.fence).bind(i32::try_from(lease.as_secs()).unwrap_or(i32::MAX)).execute(pool).await?;
    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(sqlx::Error::RowNotFound)
    }
}
async fn commit(
    pool: &PgPool,
    worker: &str,
    job: &Claim,
    manifest: &ReadyManifest,
    manifest_key: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let locked=sqlx::query("select input_snapshot from gallery_copy_job where id=$1 and state='processing' and lease_owner=$2 and fence_token=$3 for update").bind(&job.id).bind(worker).bind(job.fence).fetch_optional(&mut*tx).await?;
    if locked.is_none() {
        return Err(sqlx::Error::RowNotFound);
    }
    let blocked: bool=sqlx::query_scalar("select exists(select 1 from gallery_public_sharing_restriction restriction join gallery_listing listing on listing.artifact_id=restriction.artifact_id where listing.id=$1 and restriction.state='active') or exists(select 1 from gallery_artifact_takedown takedown join gallery_listing listing on listing.artifact_id=takedown.artifact_id where listing.id=$1 and takedown.state='active') or exists(select 1 from gallery_listing where id=$1 and lifecycle_state='removed' and closure_reason='administrator_removal') or exists(select 1 from gallery_account_closure where user_id=$2) or not exists(select 1 from gallery_runtime_status where singleton and eligible and observed_at>now()-interval '90 seconds')").bind(&job.source_listing).bind(&job.owner).fetch_one(&mut*tx).await?;
    if blocked {
        sqlx::query("update gallery_copy_job set state='cancelled',terminal_failure_code='source_governance_blocked',finished_at=now(),lease_owner=null,lease_expires_at=null where id=$1").bind(&job.id).execute(&mut*tx).await?;
        sqlx::query("update gallery_copy_attempt set state='cancelled',failure_code='source_governance_blocked',finished_at=now() where job_id=$1 and attempt_number=$2").bind(&job.id).bind(job.attempt).execute(&mut*tx).await?;
        sqlx::query("update artifact_storage_quota_account account set artifact_reserved=artifact_reserved-reservation.artifact_count,storage_bytes_reserved=storage_bytes_reserved-reservation.storage_bytes,revision=account.revision+1,updated_at=now() from artifact_storage_quota_reservation reservation where reservation.id=$1 and reservation.state='held' and account.user_id=reservation.user_id").bind(&job.reservation).execute(&mut*tx).await?;
        sqlx::query("update artifact_storage_quota_reservation set state='released',released_at=now() where id=$1 and state='held'").bind(&job.reservation).execute(&mut*tx).await?;
        sqlx::query("update gallery_copy_source_retention set release_after=now(),released_at=now() where job_id=$1 and released_at is null").bind(&job.id).execute(&mut*tx).await?;
        tx.commit().await?;
        return Ok(false);
    }
    sqlx::query("insert into artifact(id,owner_user_id,name) values($1,$2,$3)")
        .bind(&job.artifact)
        .bind(&job.owner)
        .bind(&job.title)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into content_bundle(id,owner_user_id,content_identity_revision,lifecycle_state,ready_at) values($1,$2,$3,'ready',now())").bind(&job.bundle).bind(&job.owner).bind(&job.content_revision).execute(&mut*tx).await?;
    for asset in &manifest.files {
        sqlx::query("insert into content_bundle_asset(bundle_id,owner_user_id,path,object_key,size_bytes,content_type) values($1,$2,$3,$4,$5,$6)").bind(&job.bundle).bind(&job.owner).bind(&asset.path).bind(&asset.object_key).bind(i64::try_from(asset.size_bytes).unwrap_or(i64::MAX)).bind(&asset.content_type).execute(&mut*tx).await?;
    }
    sqlx::query("insert into content_bundle_manifest(bundle_id,owner_user_id,entry_path,object_key,file_count,total_size_bytes) values($1,$2,$3,$4,$5,$6)").bind(&job.bundle).bind(&job.owner).bind(&manifest.entry_path).bind(manifest_key).bind(i32::try_from(manifest.file_count()).unwrap_or(i32::MAX)).bind(i64::try_from(manifest.total_size_bytes()).unwrap_or(i64::MAX)).execute(&mut*tx).await?;
    sqlx::query("insert into artifact_version(id,artifact_id,owner_user_id,content_bundle_id,renderer_revision,upload_session_id,version_number,state,source_kind) values($1,$2,$3,$4,$5,null,1,'ready','server_gallery_copy')").bind(&job.version).bind(&job.artifact).bind(&job.owner).bind(&job.bundle).bind(&job.renderer).execute(&mut*tx).await?;
    let root=sqlx::query("select root_listing_id,root_version_id,root_creator_profile_id from artifact_gallery_provenance provenance join gallery_listing listing on listing.artifact_id=provenance.artifact_id where listing.id=$1 union all select $1,$2,creator_profile_id from gallery_listing where id=$1 limit 1").bind(&job.source_listing).bind(&job.source_version).fetch_one(&mut*tx).await?;
    sqlx::query("insert into artifact_gallery_provenance(artifact_id,immediate_listing_id,immediate_listing_revision,immediate_version_id,root_listing_id,root_version_id,root_creator_profile_id,copy_job_id) values($1,$2,$3,$4,$5,$6,$7,$8)").bind(&job.artifact).bind(&job.source_listing).bind(job.source_revision).bind(&job.source_version).bind(root.get::<String,_>("root_listing_id")).bind(root.get::<String,_>("root_version_id")).bind(root.try_get::<String,_>("root_creator_profile_id").ok()).bind(&job.id).execute(&mut*tx).await?;
    sqlx::query("update gallery_copy_job set state='ready',finished_at=now(),lease_owner=null,lease_expires_at=null where id=$1").bind(&job.id).execute(&mut*tx).await?;
    sqlx::query("update gallery_copy_attempt set state='succeeded',finished_at=now() where job_id=$1 and attempt_number=$2").bind(&job.id).bind(job.attempt).execute(&mut*tx).await?;
    sqlx::query("update artifact_storage_quota_reservation set state='committed',committed_at=now() where id=$1 and state='held'").bind(&job.reservation).execute(&mut*tx).await?;
    sqlx::query("update artifact_storage_quota_account account set artifact_reserved=artifact_reserved-reservation.artifact_count,storage_bytes_reserved=storage_bytes_reserved-reservation.storage_bytes,artifact_usage=artifact_usage+reservation.artifact_count,storage_bytes_usage=storage_bytes_usage+reservation.storage_bytes,revision=account.revision+1,updated_at=now() from artifact_storage_quota_reservation reservation where reservation.id=$1 and account.user_id=reservation.user_id").bind(&job.reservation).execute(&mut*tx).await?;
    sqlx::query("update gallery_copy_source_retention set release_after=now(),released_at=now() where job_id=$1 and released_at is null").bind(&job.id).execute(&mut*tx).await?;
    sqlx::query("update gallery_listing_engagement set copy_count=copy_count+1,updated_at=now() where listing_id=$1").bind(&job.source_listing).execute(&mut*tx).await?;
    tx.commit().await?;
    Ok(true)
}
async fn fail<S: ObjectStorage>(
    pool: &PgPool,
    storage: &S,
    worker: &str,
    job: &Claim,
    code: &str,
) -> Result<(), sqlx::Error> {
    let _ = storage
        .remove_staging_prefix(&format!("staging/gallery-copy/{}/{}/", job.id, job.fence))
        .await;
    let _ = storage
        .remove_staging_prefix(&format!("content-bundles/{}/", job.bundle))
        .await;
    let mut tx = pool.begin().await?;
    let row=sqlx::query("select attempt_count,max_attempts from gallery_copy_job where id=$1 and lease_owner=$2 and fence_token=$3 for update").bind(&job.id).bind(worker).bind(job.fence).fetch_optional(&mut*tx).await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(());
    };
    let retryable = should_retry(code, row.get("attempt_count"), row.get("max_attempts"));
    sqlx::query("update gallery_copy_job set state=case when $4 then 'accepted' else 'failed' end,terminal_failure_code=case when $4 then null else $5 end,finished_at=case when $4 then null else now() end,lease_owner=null,lease_expires_at=null where id=$1 and lease_owner=$2 and fence_token=$3").bind(&job.id).bind(worker).bind(job.fence).bind(retryable).bind(code).execute(&mut*tx).await?;
    sqlx::query("update gallery_copy_attempt set state='failed',failure_code=$3,finished_at=now() where job_id=$1 and attempt_number=$2").bind(&job.id).bind(job.attempt).bind(code).execute(&mut*tx).await?;
    if !retryable {
        sqlx::query("update artifact_storage_quota_account account set artifact_reserved=artifact_reserved-reservation.artifact_count,storage_bytes_reserved=storage_bytes_reserved-reservation.storage_bytes,revision=account.revision+1,updated_at=now() from artifact_storage_quota_reservation reservation where reservation.id=$1 and reservation.state='held' and account.user_id=reservation.user_id").bind(&job.reservation).execute(&mut*tx).await?;
        sqlx::query("update artifact_storage_quota_reservation set state='released',released_at=now() where id=$1 and state='held'").bind(&job.reservation).execute(&mut*tx).await?;
        sqlx::query("update gallery_copy_source_retention set release_after=now(),released_at=now() where job_id=$1 and released_at is null").bind(&job.id).execute(&mut*tx).await?;
    }
    tx.commit().await
}
async fn recover(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("update gallery_copy_attempt attempt set state='lease_lost',failure_code='lease_lost',finished_at=now() from gallery_copy_job job where attempt.job_id=job.id and attempt.state='running' and job.state='processing' and job.lease_expires_at<=now()").execute(&mut*tx).await?;
    sqlx::query("update gallery_copy_job set state=case when attempt_count<max_attempts then 'accepted' else 'indeterminate' end,lease_owner=null,lease_expires_at=null where state='processing' and lease_expires_at<=now()").execute(&mut*tx).await?;
    tx.commit().await?;
    Ok(())
}
