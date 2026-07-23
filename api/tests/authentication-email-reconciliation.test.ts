import { generateKeyPairSync, sign } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuthenticationEmailReconciliationError,
  canonicalAuthenticationEmailReconciliationEnvelope,
  reconcileAuthenticationEmailDelivery,
  type AuthenticationEmailReconciliationEnvelope,
} from "../src/application/accounts/authentication-email-reconciliation.js";
import { createDatabaseConnection, type DirectDatabaseConnection } from "../src/db/connection.js";

const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const fixedNow = new Date("2030-01-02T00:00:00.000Z");
const databaseName = `shareslices_email_reconciliation_${process.pid}`;
const admin = new Client({ connectionString: process.env.DATABASE_URL });
let databaseConnection: DirectDatabaseConnection;
let pool: Pool;

function authorization(overrides: Partial<AuthenticationEmailReconciliationEnvelope> = {}) {
  const envelope: AuthenticationEmailReconciliationEnvelope = {
    version: "shareslices-authentication-email-reconciliation-v1",
    issuer: "account-maintenance.example",
    audience: "shareslices-account-maintenance",
    subject: "operator:alice",
    installation: "installation-test",
    action: "resolve-authentication-email-delivery",
    deliveryId: "delivery-reconcile",
    expectedDeliveryRevision: 3,
    transportSnapshotRevision: 1,
    attemptId: "provider-attempt-reconcile",
    attemptFence: 3,
    providerNamespace: "team-test",
    senderIdentity: "ShareSlices <auth@example.test>",
    localMessageId: "message-reconcile@example.test",
    providerMessageId: "provider-message-1",
    payloadDigest: "a".repeat(64),
    providerSafeReplayUntil: "2030-01-01T23:55:00.000Z",
    decision: "provider_accepted",
    evidenceDigest: `sha256:${"b".repeat(64)}`,
    nonce: `nonce-${crypto.randomUUID()}`,
    issuedAt: "2030-01-01T23:59:00.000Z",
    expiresAt: "2030-01-02T00:04:00.000Z",
    ...overrides,
  };
  return {
    envelope,
    signature: sign(
      null,
      Buffer.from(canonicalAuthenticationEmailReconciliationEnvelope(envelope)),
      keys.privateKey,
    ).toString("base64url"),
  };
}

async function reconcile(overrides: Partial<AuthenticationEmailReconciliationEnvelope> = {}, now = fixedNow) {
  return reconcileAuthenticationEmailDelivery({
    ...authorization(overrides),
    publicKeyPem,
    issuer: "account-maintenance.example",
    audience: "shareslices-account-maintenance",
    installation: "installation-test",
    maximumLifetimeSeconds: 300,
    providerSafetyMarginSeconds: 30,
    databaseClients: databaseConnection,
    now,
  });
}

async function seedManualDelivery(options: Readonly<{ lease?: boolean; quiescent?: boolean }> = {}) {
  await pool.query(
    `insert into email_verification_attempt
       (id, purpose, email, destination_hint, expires_at)
     values ('verification-reconcile', 'password_reset', 'hidden@example.test', 'h***@example.test', '2030-01-03')`,
  );
  await pool.query(
    `insert into password_reset_grant (id, attempt_id, encrypted_code, expires_at)
     values ('grant-reconcile', 'verification-reconcile', 'still-encrypted', '2030-01-03')`,
  );
  await pool.query(
    `insert into authentication_email_delivery
       (id, attempt_id, email_hash, purpose, source_ip_hash, encrypted_payload, state,
        delivery_revision, transport_snapshot_revision, transport_adapter, provider_namespace,
        sender_identity, endpoint_identity, transport_configuration_revision, serializer_revision,
        payload_digest, provider_idempotency_key, provider_safe_replay_until, local_message_id,
        lease_owner, lease_expires_at)
     values ('delivery-reconcile', 'verification-reconcile', 'email-hash', 'password_reset',
       'ip-hash', 'encrypted-payload', 'manual_reconciliation', 3, 1, 'resend', 'team-test',
       'ShareSlices <auth@example.test>', 'https://api.resend.com/emails', 'resend-v1',
       'authentication-email-v1', $1, 'provider-key', '2030-01-01T23:55:00Z',
       'message-reconcile@example.test', $2, $3)`,
    ["a".repeat(64), options.lease ? "live-worker" : null, options.lease ? "2030-01-02T00:01:00Z" : null],
  );
  await pool.query(
    `insert into authentication_email_provider_attempt
       (id, delivery_id, fence, phase, maximum_call_deadline, quiescent_at)
     values ('provider-attempt-reconcile', 'delivery-reconcile', 3, 'manual_reconciliation',
       '2030-01-01T23:58:00Z', $1)`,
    [options.quiescent === false ? null : "2030-01-01T23:58:30Z"],
  );
}

describe("authentication email manual reconciliation", () => {
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create database ${databaseName}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${databaseName}`;
    databaseConnection = createDatabaseConnection({ mode: "node-direct", connectionString: url.toString() });
    pool = databaseConnection.pool;
    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    for (const migration of (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    }
  });

  beforeEach(async () => {
    await pool.query("delete from authentication_email_reconciliation_audit");
    await pool.query("delete from authentication_email_reconciliation_resolution");
    await pool.query("delete from authentication_email_reconciliation_nonce");
    await pool.query("delete from authentication_email_delivery where id = 'delivery-after-reconciliation'");
    await pool.query("delete from authentication_email_delivery where id = 'delivery-reconcile'");
    await pool.query("delete from password_reset_grant where id = 'grant-reconcile'");
    await pool.query("delete from email_verification_attempt where id = 'verification-reconcile'");
  });

  afterAll(async () => {
    await pool.query("delete from authentication_email_reconciliation_audit");
    await pool.query("delete from authentication_email_reconciliation_resolution");
    await pool.query("delete from authentication_email_reconciliation_nonce");
    await pool.query("delete from authentication_email_delivery where id = 'delivery-after-reconciliation'");
    await pool.query("delete from authentication_email_delivery where id = 'delivery-reconcile'");
    await pool.query("delete from password_reset_grant where id = 'grant-reconcile'");
    await pool.query("delete from email_verification_attempt where id = 'verification-reconcile'");
    await databaseConnection.close();
    await admin.query(`drop database ${databaseName}`);
    await admin.end();
  }, 30_000);

  it("maps correlated provider acceptance and preserves authentication material", async () => {
    await seedManualDelivery();
    await expect(reconcile()).resolves.toEqual({
      deliveryId: "delivery-reconcile", state: "sent", classification: "provider_accepted", repeated: false,
    });
    const result = await pool.query(
      `select d.state, d.result_classification, d.provider_message_id, d.encrypted_payload,
              d.delivery_revision, grant_record.encrypted_code, count(a.id)::int as audit_count
         from authentication_email_delivery d
         join password_reset_grant grant_record on grant_record.attempt_id = d.attempt_id
         join authentication_email_reconciliation_audit a on a.delivery_id = d.id
        where d.id = 'delivery-reconcile'
        group by d.id, grant_record.encrypted_code`,
    );
    expect(result.rows[0]).toMatchObject({
      state: "sent", result_classification: "provider_accepted", provider_message_id: "provider-message-1",
      encrypted_payload: "", delivery_revision: "4", encrypted_code: "still-encrypted", audit_count: 1,
    });
  });

  it("rejects replayed authorization and accepts an exact fresh-nonce repeat without another resolution", async () => {
    await seedManualDelivery();
    const first = authorization();
    const invoke = (auth: ReturnType<typeof authorization>) => reconcileAuthenticationEmailDelivery({
      ...auth, publicKeyPem, issuer: "account-maintenance.example",
      audience: "shareslices-account-maintenance", installation: "installation-test",
      maximumLifetimeSeconds: 300, providerSafetyMarginSeconds: 30,
      databaseClients: databaseConnection, now: fixedNow,
    });
    await invoke(first);
    await expect(invoke(first)).rejects.toMatchObject({ code: "authorization_replayed" });
    const repeat = authorization({
      expectedDeliveryRevision: 4,
      transportSnapshotRevision: 1,
      nonce: `nonce-${crypto.randomUUID()}`,
    });
    await expect(invoke(repeat)).resolves.toMatchObject({ repeated: true });
    const counts = await pool.query(
      `select (select count(*)::int from authentication_email_reconciliation_resolution) resolutions,
              (select count(*)::int from authentication_email_reconciliation_audit) audits`,
    );
    expect(counts.rows[0]).toEqual({ resolutions: 1, audits: 2 });
  });

  it("refuses mismatched evidence, active leases, missing quiescence, and pre-cutoff resolution", async () => {
    await seedManualDelivery({ lease: true });
    await expect(reconcile()).rejects.toMatchObject({ code: "delivery_lease_active" });
    await pool.query("update authentication_email_delivery set lease_owner = null, lease_expires_at = null");
    await expect(reconcile({ payloadDigest: "c".repeat(64) })).rejects.toMatchObject({ code: "delivery_evidence_mismatch" });
    await pool.query("update authentication_email_provider_attempt set quiescent_at = null");
    await expect(reconcile()).rejects.toMatchObject({ code: "delivery_not_quiescent" });
    await pool.query(
      "update authentication_email_provider_attempt set maximum_call_deadline = '2030-01-01T23:50:00Z', quiescent_at = '2030-01-01T23:50:30Z'",
    );
    await expect(reconcile({
      issuedAt: "2030-01-01T23:53:00.000Z",
      expiresAt: "2030-01-01T23:58:00.000Z",
    }, new Date("2030-01-01T23:54:00Z"))).rejects.toMatchObject({
      code: "delivery_not_quiescent",
    });
  });

  it("rejects an invalid signature before opening a database transaction", async () => {
    await seedManualDelivery();
    const auth = authorization();
    await expect(reconcileAuthenticationEmailDelivery({
      ...auth, signature: Buffer.from("wrong").toString("base64url"), publicKeyPem,
      issuer: "account-maintenance.example", audience: "shareslices-account-maintenance",
      installation: "installation-test", maximumLifetimeSeconds: 300,
      providerSafetyMarginSeconds: 30, databaseClients: databaseConnection, now: fixedNow,
    })).rejects.toBeInstanceOf(AuthenticationEmailReconciliationError);
    expect((await pool.query("select count(*)::int count from authentication_email_reconciliation_nonce")).rows[0].count).toBe(0);
  });

  it.each([
    { installation: "wrong-installation" },
    { providerNamespace: "wrong-team" },
    { localMessageId: "wrong-message@example.test" },
    { attemptId: "wrong-attempt" },
    { attemptFence: 99 },
    { providerSafeReplayUntil: "2030-01-01T23:54:59.000Z" },
  ] as const)("rejects authorization evidence that does not correlate: $s", async (mismatch) => {
    await seedManualDelivery();
    await expect(reconcile(mismatch)).rejects.toBeInstanceOf(AuthenticationEmailReconciliationError);
    expect((await pool.query("select count(*)::int count from authentication_email_reconciliation_resolution")).rows[0].count)
      .toBe(0);
  });

  it.each([
    ["provider_rejected", "manual_provider_rejection"],
    ["acceptance_unresolved", "manual_acceptance_unresolved"],
  ] as const)("maps %s to failed without mutating the reset grant", async (decision, reason) => {
    await seedManualDelivery();
    await expect(reconcile({ decision, providerMessageId: null })).resolves.toMatchObject({
      state: "failed", classification: decision, repeated: false,
    });
    const row = await pool.query(
      `select d.state, d.result_classification, d.failure_reason_code, d.encrypted_payload,
              grant_record.encrypted_code, grant_record.consumed_at
         from authentication_email_delivery d
         join password_reset_grant grant_record on grant_record.attempt_id = d.attempt_id
        where d.id = 'delivery-reconcile'`,
    );
    expect(row.rows[0]).toMatchObject({
      state: "failed", result_classification: decision, failure_reason_code: reason,
      encrypted_payload: "", encrypted_code: "still-encrypted", consumed_at: null,
    });
  });

  it("serializes concurrent use of one nonce and rejects a conflicting fresh-nonce repeat", async () => {
    await seedManualDelivery();
    const shared = authorization();
    const invoke = (auth: ReturnType<typeof authorization>) => reconcileAuthenticationEmailDelivery({
      ...auth, publicKeyPem, issuer: "account-maintenance.example",
      audience: "shareslices-account-maintenance", installation: "installation-test",
      maximumLifetimeSeconds: 300, providerSafetyMarginSeconds: 30,
      databaseClients: databaseConnection, now: fixedNow,
    });
    const concurrent = await Promise.allSettled([invoke(shared), invoke(shared)]);
    expect(concurrent.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const conflict = authorization({
      expectedDeliveryRevision: 4,
      transportSnapshotRevision: 1,
      decision: "provider_rejected",
      providerMessageId: null,
      nonce: `nonce-${crypto.randomUUID()}`,
    });
    await expect(invoke(conflict)).rejects.toMatchObject({ code: "resolution_conflict" });
  });

  it("prevents a late provider completion from overwriting a reconciled result", async () => {
    await seedManualDelivery();
    await reconcile();
    const late = await pool.query(
      `update authentication_email_delivery d
          set state = 'sent', provider_message_id = 'late-provider-message'
         from authentication_email_provider_attempt p
        where d.id = p.delivery_id and d.id = 'delivery-reconcile'
          and d.state = 'sending' and p.phase in ('submitting', 'awaiting_final_acceptance')`,
    );
    expect(late.rowCount).toBe(0);
    expect((await pool.query(
      "select provider_message_id from authentication_email_delivery where id = 'delivery-reconcile'",
    )).rows[0].provider_message_id).toBe("provider-message-1");
  });

  it("allows an expired lease and serializes against a reset-grant holder", async () => {
    await seedManualDelivery({ lease: true });
    await pool.query("update authentication_email_delivery set lease_expires_at = '2030-01-01T23:59:00Z'");
    const lock = await pool.connect();
    await lock.query("begin");
    await lock.query("select id from password_reset_grant where id = 'grant-reconcile' for update");
    let settled = false;
    const pending = reconcile().finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    await lock.query("commit");
    lock.release();
    await expect(pending).resolves.toMatchObject({ state: "sent" });
    expect((await pool.query(
      "select encrypted_code, consumed_at from password_reset_grant where id = 'grant-reconcile'",
    )).rows[0]).toEqual({ encrypted_code: "still-encrypted", consumed_at: null });
  });

  it("permits a later ordinary delivery identity to reuse the still-active code", async () => {
    await seedManualDelivery();
    await reconcile({ decision: "acceptance_unresolved", providerMessageId: null });
    await pool.query(
      `insert into authentication_email_delivery
         (id, attempt_id, email_hash, purpose, source_ip_hash, encrypted_payload, state)
       values ('delivery-after-reconciliation', 'verification-reconcile', 'email-hash',
         'password_reset', 'ip-hash', 'new-encrypted-payload', 'pending')`,
    );
    const rows = await pool.query(
      `select d.id, d.state, grant_record.encrypted_code, grant_record.consumed_at
         from authentication_email_delivery d
         join password_reset_grant grant_record on grant_record.attempt_id = d.attempt_id
        where d.id = 'delivery-after-reconciliation'`,
    );
    expect(rows.rows[0]).toEqual({
      id: "delivery-after-reconciliation", state: "pending",
      encrypted_code: "still-encrypted", consumed_at: null,
    });
    await pool.query("delete from authentication_email_delivery where id = 'delivery-after-reconciliation'");
  });
});
