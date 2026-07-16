import type { Pool, PoolClient } from "pg";

export type QuotaPolicy = Readonly<{
  revision: string;
  artifactLimit: number;
  storageBytesLimit: number;
  copyRateLimit: number;
  copyRateWindowSeconds: number;
}>;

export type QuotaReservationResult =
  | Readonly<{ kind: "reserved"; reservationId: string; policy: QuotaPolicy }>
  | Readonly<{ kind: "insufficient_artifacts" | "insufficient_storage"; policy: QuotaPolicy }>;

const number = (value: unknown): number => Number(value);

export class GalleryQuotaAccounting {
  constructor(private readonly pool: Pool) {}

  async reserve(input: Readonly<{reservationId: string; userId: string; artifactCount: number; storageBytes: number; expiresAt: Date}>): Promise<QuotaReservationResult> {
    return this.transaction(async (client) => {
      const policy = await this.currentPolicy(client);
      await client.query(`insert into artifact_storage_quota_account (user_id, policy_revision)
        values ($1, $2) on conflict (user_id) do nothing`, [input.userId, policy.revision]);
      const { rows } = await client.query("select * from artifact_storage_quota_account where user_id = $1 for update", [input.userId]);
      const account = rows[0];
      if (number(account.artifact_usage) + number(account.artifact_reserved) + input.artifactCount > policy.artifactLimit) return {kind: "insufficient_artifacts", policy};
      if (number(account.storage_bytes_usage) + number(account.storage_bytes_reserved) + input.storageBytes > policy.storageBytesLimit) return {kind: "insufficient_storage", policy};
      await client.query(`insert into artifact_storage_quota_reservation
        (id, user_id, policy_revision, artifact_count, storage_bytes, expires_at)
        values ($1, $2, $3, $4, $5, $6)`, [input.reservationId, input.userId, policy.revision, input.artifactCount, input.storageBytes, input.expiresAt]);
      await client.query(`update artifact_storage_quota_account set
        artifact_reserved = artifact_reserved + $2, storage_bytes_reserved = storage_bytes_reserved + $3,
        revision = revision + 1, updated_at = now() where user_id = $1`, [input.userId, input.artifactCount, input.storageBytes]);
      return {kind: "reserved", reservationId: input.reservationId, policy};
    });
  }

  async commit(reservationId: string): Promise<boolean> {
    return this.finish(reservationId, "committed");
  }

  async release(reservationId: string): Promise<boolean> {
    return this.finish(reservationId, "released");
  }

  async reconcile(userId: string): Promise<void> {
    await this.transaction(async (client) => {
      const policy = await this.currentPolicy(client);
      const { rows } = await client.query(`select
        (select count(*) from artifact where owner_user_id = $1) as artifact_usage,
        (select coalesce(sum(manifest.total_size_bytes), 0) from content_bundle bundle
          join content_bundle_manifest manifest on manifest.bundle_id = bundle.id
          where bundle.owner_user_id = $1 and bundle.lifecycle_state = 'ready') as storage_usage,
        (select coalesce(sum(artifact_count), 0) from artifact_storage_quota_reservation
          where user_id = $1 and state = 'held') as artifact_reserved,
        (select coalesce(sum(storage_bytes), 0) from artifact_storage_quota_reservation
          where user_id = $1 and state = 'held') as storage_reserved` , [userId]);
      const usage = rows[0];
      await client.query(`insert into artifact_storage_quota_account
        (user_id, policy_revision, artifact_usage, storage_bytes_usage, artifact_reserved, storage_bytes_reserved)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (user_id) do update set policy_revision = excluded.policy_revision,
          artifact_usage = excluded.artifact_usage, storage_bytes_usage = excluded.storage_bytes_usage,
          artifact_reserved = excluded.artifact_reserved, storage_bytes_reserved = excluded.storage_bytes_reserved,
          revision = artifact_storage_quota_account.revision + 1, updated_at = now()`,
        [userId, policy.revision, usage.artifact_usage, usage.storage_usage, usage.artifact_reserved, usage.storage_reserved]);
    });
  }

  async activatePolicy(policy: QuotaPolicy): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("update artifact_storage_quota_policy set active = false where active");
      await client.query(`insert into artifact_storage_quota_policy
        (revision, artifact_limit, storage_bytes_limit, copy_rate_limit, copy_rate_window_seconds, active)
        values ($1, $2, $3, $4, $5, true)`, [policy.revision, policy.artifactLimit, policy.storageBytesLimit, policy.copyRateLimit, policy.copyRateWindowSeconds]);
    });
  }

  private async finish(reservationId: string, state: "committed" | "released"): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query("select * from artifact_storage_quota_reservation where id = $1 for update", [reservationId]);
      const reservation = rows[0];
      if (!reservation || reservation.state !== "held") return false;
      await client.query(`update artifact_storage_quota_reservation set state = $2,
        committed_at = case when $2 = 'committed' then now() else null end,
        released_at = case when $2 = 'released' then now() else null end where id = $1`, [reservationId, state]);
      await client.query(`update artifact_storage_quota_account set
        artifact_reserved = artifact_reserved - $2, storage_bytes_reserved = storage_bytes_reserved - $3,
        artifact_usage = artifact_usage + case when $4 = 'committed' then $2 else 0 end,
        storage_bytes_usage = storage_bytes_usage + case when $4 = 'committed' then $3 else 0 end,
        revision = revision + 1, updated_at = now() where user_id = $1`,
        [reservation.user_id, reservation.artifact_count, reservation.storage_bytes, state]);
      return true;
    });
  }

  private async currentPolicy(client: PoolClient): Promise<QuotaPolicy> {
    const { rows } = await client.query("select * from artifact_storage_quota_policy where active for share");
    if (rows.length !== 1) throw new Error("artifact_storage_quota_policy_unavailable");
    const row = rows[0];
    return {revision: row.revision, artifactLimit: number(row.artifact_limit), storageBytesLimit: number(row.storage_bytes_limit), copyRateLimit: number(row.copy_rate_limit), copyRateWindowSeconds: number(row.copy_rate_window_seconds)};
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("begin"); const result = await work(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
}
