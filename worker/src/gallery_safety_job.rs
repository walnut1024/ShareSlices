use std::{fmt::Write, sync::Arc, time::Duration};

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use tokio::io::AsyncReadExt;

use crate::{
    gallery_job_contract::SUPPORTED_CONTRACT_VERSIONS,
    gallery_safety::{
        GallerySafetyPolicy, SafetyDecision, SafetyFinding, inspect_self_contained,
        overall_decision,
    },
    manifest::ReadyManifest,
    object_storage::ObjectStorage,
};

#[derive(Clone, Debug)]
struct ClaimedJob {
    id: String,
    fence_token: i64,
    attempt_number: i32,
    policy: GallerySafetyPolicy,
    manifest_key: String,
    expected_file_count: i64,
    expected_total_bytes: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FindingEvidence<'a> {
    code: &'a str,
    decision: &'a str,
}

pub async fn run_gallery_safety_loop<S: ObjectStorage + 'static>(
    pool: PgPool,
    storage: Arc<S>,
    worker_id: String,
    lease_duration: Duration,
    poll_interval: Duration,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    recover_expired(&pool).await.ok();
    loop {
        if *shutdown.borrow() {
            return;
        }
        match claim(&pool, &worker_id, lease_duration).await {
            Ok(Some(job)) => {
                process(&pool, storage.as_ref(), &worker_id, lease_duration, job).await;
            }
            Ok(None) => tokio::select! {
                () = tokio::time::sleep(poll_interval) => {},
                _ = shutdown.changed() => {},
            },
            Err(error) => {
                tracing::error!(
                    event_name = "shareslices.gallery.safety.claim_failed",
                    error.kind = "database",
                    "Gallery safety claim failed: {error}"
                );
                tokio::time::sleep(poll_interval).await;
            }
        }
    }
}

async fn claim(
    pool: &PgPool,
    worker_id: &str,
    lease: Duration,
) -> Result<Option<ClaimedJob>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "select job.id, job.contract_version, job.policy_snapshot, manifest.object_key, manifest.file_count, manifest.total_size_bytes
         from gallery_safety_job job
         join artifact_version version on version.id = job.version_id and version.state = 'ready'
         join content_bundle_manifest manifest on manifest.bundle_id = version.content_bundle_id
         where job.state = 'queued' and job.available_at <= now()
         order by job.available_at, job.id for update of job skip locked limit 1")
        .fetch_optional(&mut *tx).await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let id: String = row.get("id");
    let contract: String = row.get("contract_version");
    if !SUPPORTED_CONTRACT_VERSIONS.contains(&contract.as_str()) {
        sqlx::query("update gallery_safety_job set state='failed', failure_code='incompatible_contract', finished_at=now() where id=$1")
            .bind(&id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(None);
    }
    let claimed = sqlx::query(
        "update gallery_safety_job set state='running', lease_owner=$2,
         lease_expires_at=now()+make_interval(secs => $3), heartbeat_at=now(),
         fence_token=fence_token+1, attempt_count=attempt_count+1
         where id=$1 returning fence_token, attempt_count",
    )
    .bind(&id)
    .bind(worker_id)
    .bind(i32::try_from(lease.as_secs()).unwrap_or(i32::MAX))
    .fetch_one(&mut *tx)
    .await?;
    let fence_token: i64 = claimed.get("fence_token");
    let attempt_number: i32 = claimed.get("attempt_count");
    sqlx::query("insert into gallery_safety_attempt(id,job_id,attempt_number,fence_token) values($1,$2,$3,$4)")
        .bind(format!("gsa-{id}-{fence_token}")).bind(&id).bind(attempt_number).bind(fence_token)
        .execute(&mut *tx).await?;
    let policy = serde_json::from_value(row.get("policy_snapshot"))
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    let job = ClaimedJob {
        id,
        fence_token,
        attempt_number,
        policy,
        manifest_key: row.get("object_key"),
        expected_file_count: row.get("file_count"),
        expected_total_bytes: row.get("total_size_bytes"),
    };
    tx.commit().await?;
    Ok(Some(job))
}

async fn process<S: ObjectStorage>(
    pool: &PgPool,
    storage: &S,
    worker_id: &str,
    lease: Duration,
    job: ClaimedJob,
) {
    let result = inspect_candidate(pool, storage, worker_id, lease, &job).await;
    match result {
        Ok((decision, findings, digest)) => {
            let _ = complete(pool, worker_id, &job, decision, &findings, &digest).await;
        }
        Err(code) => {
            let _ = fail(pool, worker_id, &job, code).await;
        }
    }
}

async fn inspect_candidate<S: ObjectStorage>(
    pool: &PgPool,
    storage: &S,
    worker_id: &str,
    lease: Duration,
    job: &ClaimedJob,
) -> Result<(SafetyDecision, Vec<SafetyFinding>, String), &'static str> {
    let manifest_reader = storage
        .read_private_object(&job.manifest_key)
        .await
        .map_err(|_| "source_unavailable")?;
    let mut manifest_bytes = Vec::new();
    manifest_reader
        .take(4 * 1024 * 1024)
        .read_to_end(&mut manifest_bytes)
        .await
        .map_err(|_| "source_unavailable")?;
    let manifest: ReadyManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "invalid_input")?;
    if i64::try_from(manifest.file_count()).ok() != Some(job.expected_file_count)
        || i64::try_from(manifest.total_size_bytes()).ok() != Some(job.expected_total_bytes)
        || manifest.file_count() as u64 > job.policy.max_file_count
        || manifest.total_size_bytes() > job.policy.max_total_bytes
    {
        return Err("invalid_input");
    }
    let mut findings = Vec::new();
    for asset in &manifest.files {
        if asset.size_bytes > job.policy.max_single_file_bytes {
            return Err("invalid_input");
        }
        renew(pool, worker_id, job, lease)
            .await
            .map_err(|()| "lease_lost")?;
        if asset.content_type.starts_with("text/")
            || matches!(
                asset.content_type.as_str(),
                "application/javascript" | "application/json" | "image/svg+xml"
            )
        {
            let reader = storage
                .read_private_object(&asset.object_key)
                .await
                .map_err(|_| "source_unavailable")?;
            let mut bytes = Vec::new();
            reader
                .take(asset.size_bytes.saturating_add(1))
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| "source_unavailable")?;
            if bytes.len() as u64 != asset.size_bytes {
                return Err("source_unavailable");
            }
            findings.extend(inspect_self_contained(
                &String::from_utf8_lossy(&bytes),
                &job.policy,
            ));
        }
    }
    findings.sort_by_key(|finding| finding.code);
    findings.dedup_by_key(|finding| finding.code);
    let evidence = findings
        .iter()
        .map(|finding| FindingEvidence {
            code: finding.code,
            decision: decision_text(finding.decision),
        })
        .collect::<Vec<_>>();
    let canonical = serde_json::to_vec(&(job.policy.policy_revision.as_str(), &evidence))
        .map_err(|_| "internal_failure")?;
    let digest = Sha256::digest(canonical)
        .iter()
        .fold(String::new(), |mut output, byte| {
            write!(output, "{byte:02x}").unwrap();
            output
        });
    Ok((overall_decision(&findings), findings, digest))
}

async fn renew(
    pool: &PgPool,
    worker_id: &str,
    job: &ClaimedJob,
    lease: Duration,
) -> Result<(), ()> {
    let result = sqlx::query("update gallery_safety_job set heartbeat_at=now(), lease_expires_at=now()+make_interval(secs => $4) where id=$1 and state='running' and lease_owner=$2 and fence_token=$3")
        .bind(&job.id).bind(worker_id).bind(job.fence_token).bind(i32::try_from(lease.as_secs()).unwrap_or(i32::MAX)).execute(pool).await.map_err(|_| ())?;
    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(())
    }
}

async fn complete(
    pool: &PgPool,
    worker_id: &str,
    job: &ClaimedJob,
    decision: SafetyDecision,
    findings: &[SafetyFinding],
    digest: &str,
) -> Result<(), sqlx::Error> {
    let evidence = findings
        .iter()
        .map(|finding| FindingEvidence {
            code: finding.code,
            decision: decision_text(finding.decision),
        })
        .collect::<Vec<_>>();
    let mut tx = pool.begin().await?;
    let result = sqlx::query("update gallery_safety_job set state='succeeded', decision=$4, findings=$5, evidence_digest=$6, finished_at=now(), lease_owner=null, lease_expires_at=null, heartbeat_at=null where id=$1 and state='running' and lease_owner=$2 and fence_token=$3 and policy_revision=$7")
        .bind(&job.id).bind(worker_id).bind(job.fence_token).bind(decision_text(decision)).bind(serde_json::to_value(evidence).unwrap()).bind(digest).bind(&job.policy.policy_revision).execute(&mut *tx).await?;
    let attempt_state = if result.rows_affected() == 1 {
        "succeeded"
    } else {
        "lease_lost"
    };
    sqlx::query("update gallery_safety_attempt set state=$4, finished_at=now(), failure_code=case when $4='lease_lost' then 'lease_lost' end where job_id=$1 and attempt_number=$2 and fence_token=$3")
        .bind(&job.id).bind(job.attempt_number).bind(job.fence_token).bind(attempt_state).execute(&mut *tx).await?;
    tx.commit().await
}

async fn fail(
    pool: &PgPool,
    worker_id: &str,
    job: &ClaimedJob,
    code: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let result = sqlx::query("update gallery_safety_job set state=case when attempt_count<max_attempts and $4 not in ('invalid_input','incompatible_contract') then 'queued' else 'failed' end, failure_code=case when attempt_count<max_attempts and $4 not in ('invalid_input','incompatible_contract') then null else $4 end, available_at=now()+interval '5 seconds', finished_at=case when attempt_count<max_attempts and $4 not in ('invalid_input','incompatible_contract') then null else now() end, lease_owner=null, lease_expires_at=null, heartbeat_at=null where id=$1 and state='running' and lease_owner=$2 and fence_token=$3")
        .bind(&job.id).bind(worker_id).bind(job.fence_token).bind(code).execute(&mut *tx).await?;
    let state = if result.rows_affected() == 1 {
        "failed"
    } else {
        "lease_lost"
    };
    sqlx::query("update gallery_safety_attempt set state=$4, finished_at=now(), failure_code=$5 where job_id=$1 and attempt_number=$2 and fence_token=$3")
        .bind(&job.id).bind(job.attempt_number).bind(job.fence_token).bind(state).bind(code).execute(&mut *tx).await?;
    tx.commit().await
}

async fn recover_expired(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("update gallery_safety_attempt attempt set state='lease_lost', finished_at=now(), failure_code='lease_lost' from gallery_safety_job job where attempt.job_id=job.id and attempt.state='running' and job.state='running' and job.lease_expires_at<=now()")
        .execute(&mut *tx).await?;
    sqlx::query("update gallery_safety_job set state=case when attempt_count<max_attempts then 'queued' else 'failed' end, failure_code=case when attempt_count<max_attempts then null else 'lease_lost' end, available_at=now(), finished_at=case when attempt_count<max_attempts then null else now() end, lease_owner=null, lease_expires_at=null, heartbeat_at=null where state='running' and lease_expires_at<=now()")
        .execute(&mut *tx).await?;
    tx.commit().await
}

fn decision_text(value: SafetyDecision) -> &'static str {
    match value {
        SafetyDecision::Pass => "pass",
        SafetyDecision::Review => "review",
        SafetyDecision::Reject => "reject",
    }
}
