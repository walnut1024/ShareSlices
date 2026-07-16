use std::time::Duration;

use sqlx::{PgPool, Row};

pub async fn run_gallery_cover_loop(
    pool: PgPool,
    poll_interval: Duration,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            return;
        }
        if let Err(error) = reconcile_one(&pool).await {
            tracing::error!(
                event_name = "shareslices.gallery.cover.reconcile_failed",
                error.kind = "database",
                "Gallery cover reconciliation failed: {error}"
            );
        }
        tokio::select! {
            () = tokio::time::sleep(poll_interval) => {},
            _ = shutdown.changed() => {}
        }
    }
}

async fn reconcile_one(pool: &PgPool) -> Result<(), sqlx::Error> {
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
        return Ok(());
    };
    let id: String = row.get("id");
    let cover_id: String = row.get("cover_id");
    let version_id: String = row.get("version_id");
    let bundle_id: String = row.get("content_bundle_id");
    let renderer: String = row.get("renderer_revision");
    sqlx::query(
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
        "select thumbnail.object_key,thumbnail.content_type,thumbnail.width,thumbnail.height,job.state,attempt.failure_code
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
    if let Ok(object_key) = result.try_get::<String, _>("object_key") {
        sqlx::query("update gallery_cover set state='ready',object_key=$2,content_type=$3,width=$4,height=$5,failure_code=null,updated_at=now() where id=$1 and state='pending'")
            .bind(&cover_id).bind(object_key).bind(result.get::<String,_>("content_type"))
            .bind(result.get::<i32,_>("width")).bind(result.get::<i32,_>("height"))
            .execute(&mut *transaction).await?;
        sqlx::query("update gallery_cover_job set state='succeeded',finished_at=now(),lease_owner=null,lease_expires_at=null,heartbeat_at=null where id=$1")
            .bind(&id).execute(&mut *transaction).await?;
    } else if matches!(state.as_str(), "failed" | "cancelled") {
        let code = result
            .try_get::<String, _>("failure_code")
            .unwrap_or_else(|_| "render_failed".to_owned());
        sqlx::query("update gallery_cover set state='failed',failure_code=$2,updated_at=now() where id=$1 and state='pending'")
            .bind(&cover_id).bind(&code).execute(&mut *transaction).await?;
        sqlx::query("update gallery_cover_job set state='failed',failure_code=$2,finished_at=now(),lease_owner=null,lease_expires_at=null,heartbeat_at=null where id=$1")
            .bind(&id).bind(code).execute(&mut *transaction).await?;
    }
    transaction.commit().await
}
