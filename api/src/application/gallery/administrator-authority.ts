import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
export class GalleryAdministratorError extends Error {
  constructor(readonly code: "administrator_forbidden") {
    super(code);
  }
}
export class GalleryAdministratorAuthority {
  constructor(private readonly pool: Pool) {}
  async require(
    userId: string,
    action:
      | "queue_read"
      | "case_read"
      | "decision"
      | "appeal_read"
      | "featured_change",
    resourceId: string | null = null,
    client?: PoolClient,
  ): Promise<void> {
    const database = client ?? this.pool;
    const active =
      (
        await database.query(
          "select 1 from gallery_administrator_authority where user_id=$1 and scope='gallery_governance' and revoked_at is null",
          [userId],
        )
      ).rowCount === 1;
    if (!active) throw new GalleryAdministratorError("administrator_forbidden");
    await database.query(
      "insert into gallery_administrator_audit_event(id,actor_user_id,action,resource_id) values($1,$2,$3,$4)",
      [`gadminaudit_${randomUUID()}`, userId, action, resourceId],
    );
  }
  async grant(actorUserId: string, subjectUserId: string): Promise<void> {
    await this.require(actorUserId, "decision", "authority");
    await this.pool.query(
      "insert into gallery_administrator_authority(user_id,granted_by_user_id) values($1,$2) on conflict(user_id) do update set revoked_at=null,granted_by_user_id=$2,granted_at=now(),revision=gallery_administrator_authority.revision+1",
      [subjectUserId, actorUserId],
    );
    await this.pool.query(
      "insert into gallery_administrator_audit_event(id,actor_user_id,subject_user_id,action) values($1,$2,$3,'grant')",
      [`gadminaudit_${randomUUID()}`, actorUserId, subjectUserId],
    );
  }
  async revoke(actorUserId: string, subjectUserId: string): Promise<void> {
    await this.require(actorUserId, "decision", "authority");
    await this.pool.query(
      "update gallery_administrator_authority set revoked_at=now(),revision=revision+1 where user_id=$1 and revoked_at is null",
      [subjectUserId],
    );
    await this.pool.query(
      "insert into gallery_administrator_audit_event(id,actor_user_id,subject_user_id,action) values($1,$2,$3,'revoke')",
      [`gadminaudit_${randomUUID()}`, actorUserId, subjectUserId],
    );
  }
}
