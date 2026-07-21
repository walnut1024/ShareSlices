use sqlx::{PgPool, Row};

use crate::runner::{BackgroundLane, ClaimPermit, LaneRunOutcome, RunnerError, RunnerLane};

pub struct GalleryCoverLane {
    pool: PgPool,
}

impl GalleryCoverLane {
    #[must_use]
    pub const fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn run_reconciliation(&self) -> LaneRunOutcome {
        match reconcile_one(&self.pool).await {
            Ok(true) => LaneRunOutcome::Claimed,
            Ok(false) => LaneRunOutcome::Idle,
            Err(error) => {
                tracing::error!(
                    event_name = "shareslices.gallery.cover.reconcile_failed",
                    error.kind = "database",
                    "Gallery cover reconciliation failed: {error}"
                );
                LaneRunOutcome::Idle
            }
        }
    }
}

#[async_trait::async_trait(?Send)]
impl BackgroundLane for GalleryCoverLane {
    fn lane(&self) -> RunnerLane {
        RunnerLane::GalleryCover
    }

    async fn run_one(&self, _permit: ClaimPermit) -> Result<LaneRunOutcome, RunnerError> {
        Ok(self.run_reconciliation().await)
    }

    async fn has_claimable_work(&self) -> Result<bool, RunnerError> {
        sqlx::query_scalar::<_, bool>(
            "select exists(select 1 from gallery_cover_job where state in ('queued','running'))",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|_| RunnerError::Lane("Gallery cover work observation failed".to_owned()))
    }
}

async fn reconcile_one(pool: &PgPool) -> Result<bool, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query(
        "select job.id,job.cover_id,job.version_id,job.renderer_revision,version.content_bundle_id
         from gallery_cover_job job join artifact_version version on version.id=job.version_id and version.state='ready'
         where job.state in ('queued','running') order by job.available_at,job.id
         for update of job skip locked limit 1",
    )
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(row) = row else {
        transaction.commit().await?;
        return Ok(false);
    };
    let id: String = row.try_get("id")?;
    let cover_id: String = row.try_get("cover_id")?;
    let version_id: String = row.try_get("version_id")?;
    let bundle_id: Option<String> = row.try_get("content_bundle_id")?;
    let renderer: String = row.try_get("renderer_revision")?;
    let Some(bundle_id) = bundle_id else {
        sqlx::query("update gallery_cover set state='failed',failure_code='source_unavailable',updated_at=now() where id=$1 and state='pending'")
            .bind(&cover_id).execute(&mut *transaction).await?;
        sqlx::query("update gallery_cover_job set state='failed',failure_code='source_unavailable',finished_at=now(),lease_owner=null,lease_expires_at=null,heartbeat_at=null where id=$1")
            .bind(&id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        return Ok(true);
    };
    let inserted = sqlx::query(
        "insert into content_bundle_thumbnail_job(id,bundle_id,owner_user_id,renderer_revision,max_attempts)
         select 'gallery-thumb-'||$1,content_bundle_id,owner_user_id,$2,3 from artifact_version where id=$3
         on conflict(bundle_id,renderer_revision) do nothing",
    )
    .bind(&id)
    .bind(&renderer)
    .bind(&version_id)
    .execute(&mut *transaction)
    .await?;
    let result = sqlx::query(
        "select thumbnail.object_key,thumbnail.content_type,thumbnail.width,thumbnail.height,job.state,job.failure_reason_code
         from content_bundle_thumbnail_job job
         left join content_bundle_thumbnail thumbnail on thumbnail.bundle_id=job.bundle_id and thumbnail.renderer_revision=job.renderer_revision
         left join content_bundle_thumbnail_attempt attempt on attempt.job_id=job.id and attempt.state='failed'
         where job.bundle_id=$1 and job.renderer_revision=$2 order by attempt.attempt_number desc limit 1",
    )
    .bind(&bundle_id)
    .bind(&renderer)
    .fetch_one(&mut *transaction)
    .await?;
    let state: String = result.get("state");
    let transitioned = if let Ok(object_key) = result.try_get::<String, _>("object_key") {
        let content_type: String = result.try_get("content_type")?;
        let width: i32 = result.try_get("width")?;
        let height: i32 = result.try_get("height")?;
        sqlx::query("update gallery_cover set state='ready',object_key=$2,content_type=$3,width=$4,height=$5,failure_code=null,updated_at=now() where id=$1 and state='pending'")
            .bind(&cover_id).bind(object_key).bind(content_type)
            .bind(width).bind(height)
            .execute(&mut *transaction).await?;
        sqlx::query("update gallery_cover_job set state='succeeded',finished_at=now(),lease_owner=null,lease_expires_at=null,heartbeat_at=null where id=$1")
            .bind(&id).execute(&mut *transaction).await?;
        true
    } else if matches!(state.as_str(), "failed" | "cancelled") {
        let code = result
            .try_get::<String, _>("failure_reason_code")
            .unwrap_or_else(|_| "render_failed".to_owned());
        sqlx::query("update gallery_cover set state='failed',failure_code=$2,updated_at=now() where id=$1 and state='pending'")
            .bind(&cover_id).bind(&code).execute(&mut *transaction).await?;
        sqlx::query("update gallery_cover_job set state='failed',failure_code=$2,finished_at=now(),lease_owner=null,lease_expires_at=null,heartbeat_at=null where id=$1")
            .bind(&id).bind(code).execute(&mut *transaction).await?;
        true
    } else {
        false
    };
    transaction.commit().await?;
    Ok(transitioned || inserted.rows_affected() == 1)
}
