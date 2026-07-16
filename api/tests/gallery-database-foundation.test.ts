import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GalleryQuotaAccounting } from "../src/application/gallery/quota-accounting.js";
import { GalleryGovernanceService } from "../src/application/gallery/governance.js";
import { GalleryReconciliation } from "../src/application/gallery/reconciliation.js";

const { Client } = pg;

describe("Gallery database invariants", () => {
  const schemaName = `gallery_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let quotaPool: pg.Pool;

  beforeAll(async () => {
    await client.connect();
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}"`);
    const directory = resolve(process.cwd(), "../db/migrations");
    for (const file of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await client.query(await readFile(resolve(directory, file), "utf8"));
    }
    quotaPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await client.query(`insert into "user" (id, name, email) values
      ('owner-1', 'Owner One', 'one@example.test'), ('owner-2', 'Owner Two', 'two@example.test')`);
    await client.query(`insert into artifact (id, owner_user_id, name) values
      ('artifact-1', 'owner-1', 'Artifact One'), ('artifact-2', 'owner-2', 'Artifact Two')`);
    await client.query(`insert into gallery_creator_profile (id, user_id, opaque_slug, display_name) values
      ('profile-1', 'owner-1', 'creator_one', 'Creator One'),
      ('profile-2', 'owner-2', 'creator_two', 'Creator Two')`);
  });

  afterAll(async () => {
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    await client.end();
    await quotaPool.end();
  });

  it("enforces one profile per User and one open listing per Artifact", async () => {
    await expect(
      client.query(
        "insert into gallery_creator_profile (id, user_id, opaque_slug, display_name) values ('profile-duplicate', 'owner-1', 'creator_duplicate', 'Duplicate')",
      ),
    ).rejects.toThrow();
    await client.query(
      "insert into gallery_listing (id, artifact_id, owner_user_id, creator_profile_id, opaque_slug) values ('listing-open', 'artifact-1', 'owner-1', 'profile-1', 'opaque_slug_for_listing_one')",
    );
    await expect(
      client.query(
        "insert into gallery_listing (id, artifact_id, owner_user_id, creator_profile_id, opaque_slug) values ('listing-conflict', 'artifact-1', 'owner-1', 'profile-1', 'opaque_slug_for_listing_two')",
      ),
    ).rejects.toThrow();
  });

  it("serializes terminal transitions by listing revision and validates closure reasons", async () => {
    const winner = await client.query(
      "update gallery_listing set lifecycle_state = 'withdrawn', closure_reason = 'creator_withdrawal', closed_at = now(), listing_revision = listing_revision + 1 where id = 'listing-open' and listing_revision = 1 returning listing_revision",
    );
    expect(winner.rows[0].listing_revision).toBe("2");
    const loser = await client.query(
      "update gallery_listing set lifecycle_state = 'removed', closure_reason = 'administrator_removal', listing_revision = listing_revision + 1 where id = 'listing-open' and listing_revision = 1 returning id",
    );
    expect(loser.rowCount).toBe(0);
    await expect(
      client.query(
        "update gallery_listing set closure_reason = 'unknown_reason' where id = 'listing-open'",
      ),
    ).rejects.toThrow();
  });

  it("retires slugs and keeps lifecycle evidence immutable", async () => {
    await client.query(
      "insert into gallery_listing_closure_tombstone (listing_id, opaque_slug, was_ever_public, terminal_lifecycle_state, closure_reason) values ('listing-open', 'opaque_slug_for_listing_one', true, 'withdrawn', 'creator_withdrawal')",
    );
    await expect(
      client.query(
        "update gallery_listing_closure_tombstone set was_ever_public = false where listing_id = 'listing-open'",
      ),
    ).rejects.toThrow("immutable");
    await expect(
      client.query(
        "insert into gallery_listing (id, artifact_id, owner_user_id, creator_profile_id, opaque_slug) values ('listing-reuse', 'artifact-1', 'owner-1', 'profile-1', 'opaque_slug_for_listing_one')",
      ),
    ).rejects.toThrow();
  });

  it("keeps grant evidence optional until acceptance and immutable afterward", async () => {
    expect(
      (
        await client.query(
          "select * from gallery_permission_grant_acceptance where listing_id = 'listing-open'",
        )
      ).rows,
    ).toEqual([]);
    await client.query(
      "insert into gallery_permission_grant_acceptance (id, user_id, listing_id, grant_version, grant_text_digest) values ('grant-1', 'owner-1', 'listing-open', 'grant/v1', repeat('a', 64))",
    );
    await expect(
      client.query(
        "update gallery_permission_grant_acceptance set grant_version = 'grant/v2' where id = 'grant-1'",
      ),
    ).rejects.toThrow("immutable");
  });

  it("enforces quota reservation projections and active governance uniqueness", async () => {
    await expect(
      client.query(
        "insert into artifact_storage_quota_reservation (id, user_id, policy_revision, artifact_count, storage_bytes, state, expires_at, committed_at) values ('bad-reservation', 'owner-1', 'artifact-storage/v1', 1, 10, 'held', now() + interval '1 hour', now())",
      ),
    ).rejects.toThrow();
    const indexes = (
      await client.query(
        "select indexname from pg_indexes where schemaname = $1",
        [schemaName],
      )
    ).rows.map(({ indexname }) => indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "gallery_one_active_public_sharing_restriction_idx",
        "gallery_one_active_artifact_takedown_idx",
        "gallery_copy_source_retention_live_idx",
        "gallery_download_source_lease_live_source_idx",
      ]),
    );
  });

  it("preserves same-User Content-bundle ownership as the cross-User copy boundary", async () => {
    const constraints = await client.query(
      "select conname from pg_constraint where connamespace = $1::regnamespace",
      [schemaName],
    );
    expect(constraints.rows.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        "artifact_version_content_bundle_owner_fk",
        "content_bundle_id_owner_user_unique",
        "gallery_copy_job_copier_user_id_fkey",
      ]),
    );
  });

  it("fences proposals, resets replacement aggregates, and records source liveness", async () => {
    await client.query(`insert into artifact_upload_session
      (id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes, file_count,
       single_file_size_bytes, formats, raw_object_key, raw_size_bytes, state, owner_user_id)
      values ('upload-2', 'artifact-2', 'policy/v1', 1000, 2000, 10, 1000, '[]',
       'raw/upload-2', 100, 'committed', 'owner-2')`);
    await client.query(
      "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ('version-2', 'artifact-2', 'upload-2', 1, 'ready')",
    );
    await client.query(
      "insert into gallery_listing (id, artifact_id, owner_user_id, creator_profile_id, opaque_slug) values ('listing-2', 'artifact-2', 'owner-2', 'profile-2', 'opaque_slug_for_listing_three')",
    );
    await client.query(
      "insert into gallery_permission_grant_acceptance (id, user_id, listing_id, grant_version, grant_text_digest) values ('grant-2', 'owner-2', 'listing-2', 'grant/v1', repeat('b', 64))",
    );
    await client.query(
      "insert into gallery_listing_proposal (id, listing_id, base_listing_revision, version_id, permission_acceptance_id, public_title, tags) values ('proposal-2', 'listing-2', 1, 'version-2', 'grant-2', 'Public title', array['demo'])",
    );
    await expect(
      client.query(
        "insert into gallery_listing_proposal (id, listing_id, base_listing_revision, version_id, permission_acceptance_id, public_title, tags) values ('proposal-conflict', 'listing-2', 1, 'version-2', 'grant-2', 'Other', array['demo'])",
      ),
    ).rejects.toThrow();
    const promoted = await client.query(
      "update gallery_listing set listing_revision = 2 where id = 'listing-2' and listing_revision = 1 returning id",
    );
    expect(promoted.rowCount).toBe(1);
    expect(
      (
        await client.query(
          "update gallery_listing set listing_revision = 3 where id = 'listing-2' and listing_revision = 1 returning id",
        )
      ).rowCount,
    ).toBe(0);

    await client.query(
      "insert into gallery_listing_engagement (listing_id, view_count, download_count, copy_count) values ('listing-open', 7, 3, 2)",
    );
    await client.query(
      "insert into gallery_listing (id, artifact_id, owner_user_id, creator_profile_id, opaque_slug) values ('listing-replacement', 'artifact-1', 'owner-1', 'profile-1', 'opaque_slug_for_replacement')",
    );
    expect(
      (
        await client.query(
          "select * from gallery_listing_engagement where listing_id = 'listing-replacement'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await client.query(
          "select view_count, download_count, copy_count from gallery_listing_engagement where listing_id = 'listing-open'",
        )
      ).rows[0],
    ).toEqual({ view_count: "7", download_count: "3", copy_count: "2" });

    await client.query(
      "insert into gallery_download_source_lease (id, listing_id, listing_revision, version_id, instance_id, lease_token_digest, expires_at) values ('download-1', 'listing-2', 2, 'version-2', 'instance-a', 'token-digest', now() + interval '1 hour')",
    );
    expect(
      (
        await client.query(
          "select count(*)::int as count from gallery_download_source_lease where version_id = 'version-2' and state = 'active' and expires_at > now()",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("snapshots Appeal policy and prevents duplicate or mutable governance evidence", async () => {
    await client.query(
      "insert into gallery_administrator_authority (user_id, granted_by_user_id) values ('owner-1', 'owner-1')",
    );
    await client.query(
      "insert into gallery_appeal_policy (version, deadline_seconds, active) values ('appeal/v1', 604800, true)",
    );
    await client.query(
      "insert into gallery_governance_case (id, case_kind, listing_id, state, evidence_snapshot, evidence_digest) values ('case-1', 'removal', 'listing-2', 'open', '{}', 'evidence-1')",
    );
    await client.query(
      "insert into gallery_governance_decision (id, case_id, actor_user_id, decision_kind, rule_code, rationale, evidence_digest, appeal_policy_version, appeal_deadline_at, idempotency_key_digest, input_fingerprint) values ('decision-1', 'case-1', 'owner-1', 'remove', 'unsafe_content', 'Checked rationale', 'evidence-1', 'appeal/v1', now() + interval '7 days', 'key-1', 'input-1')",
    );
    await expect(
      client.query(
        "update gallery_governance_decision set rationale = 'Changed' where id = 'decision-1'",
      ),
    ).rejects.toThrow("immutable");
    await client.query(
      "insert into gallery_appeal (id, case_id, decision_id, appellant_user_id, policy_version, deadline_at, statement, idempotency_key_digest, input_fingerprint) values ('appeal-1', 'case-1', 'decision-1', 'owner-2', 'appeal/v1', now() + interval '7 days', 'Please review', 'appeal-key-1', 'appeal-input-1')",
    );
    await expect(
      client.query(
        "insert into gallery_appeal (id, case_id, decision_id, appellant_user_id, policy_version, deadline_at, statement, idempotency_key_digest, input_fingerprint) values ('appeal-2', 'case-1', 'decision-1', 'owner-2', 'appeal/v1', now() + interval '7 days', 'Again', 'appeal-key-2', 'appeal-input-2')",
      ),
    ).rejects.toThrow();
  });

  it("enforces restoration uniqueness and the explicit source-deletion conversion", async () => {
    await client.query(
      "update gallery_listing_proposal set state = 'promoted', closed_at = now() where id = 'proposal-2'",
    );
    await client.query(
      "insert into gallery_listing_revision (id, listing_id, revision, version_id, permission_acceptance_id, public_title, tags) values ('revision-2', 'listing-2', 1, 'version-2', 'grant-2', 'Public title', array['demo'])",
    );
    await client.query(
      "update gallery_listing set lifecycle_state = 'listed', current_revision_id = 'revision-2', listing_revision = 3 where id = 'listing-2'",
    );
    await client.query(
      "update gallery_listing set lifecycle_state = 'removed', closure_reason = 'administrator_removal', closed_at = now(), listing_revision = 4 where id = 'listing-2'",
    );
    await client.query(
      "insert into gallery_listing (id, artifact_id, owner_user_id, creator_profile_id, opaque_slug) values ('listing-2-replacement', 'artifact-2', 'owner-2', 'profile-2', 'opaque_slug_for_listing_four')",
    );
    await expect(
      client.query(
        "update gallery_listing set lifecycle_state = 'listed', closure_reason = null, closed_at = null, listing_revision = 5 where id = 'listing-2'",
      ),
    ).rejects.toThrow();
    await client.query(
      "update gallery_listing set lifecycle_state = 'withdrawn', closure_reason = 'artifact_deleted', closed_at = now(), listing_revision = 5 where id = 'listing-2'",
    );
    expect(
      (
        await client.query(
          "select lifecycle_state, closure_reason from gallery_listing where id = 'listing-2'",
        )
      ).rows[0],
    ).toEqual({
      lifecycle_state: "withdrawn",
      closure_reason: "artifact_deleted",
    });
  });

  it("holds copy sources and persists immutable multi-generation provenance", async () => {
    await client.query(
      "insert into artifact (id, owner_user_id, name) values ('artifact-copy', 'owner-2', 'Copied Artifact')",
    );
    await client.query(
      "insert into artifact_storage_quota_reservation (id, user_id, policy_revision, artifact_count, storage_bytes, state, expires_at) values ('reservation-copy', 'owner-2', 'artifact-storage/v1', 1, 100, 'held', now() + interval '1 hour')",
    );
    await client.query(`insert into gallery_copy_job
      (id, copier_user_id, source_listing_id, source_listing_revision, source_version_id,
       destination_artifact_id, destination_version_id, destination_title, quota_reservation_id,
       contract_version, input_snapshot, input_snapshot_digest, idempotency_key_digest,
       input_fingerprint, max_attempts)
      values ('copy-job-1', 'owner-2', 'listing-2', 3, 'version-2', 'artifact-copy',
       'version-copy', 'Copied Artifact', 'reservation-copy', 'gallery-job/v1', '{}', repeat('c', 64),
       'copy-key-1', 'copy-input-1', 3)`);
    await client.query(
      "insert into gallery_copy_source_retention (id, job_id, source_listing_id, source_version_id) values ('retention-copy', 'copy-job-1', 'listing-2', 'version-2')",
    );
    expect(
      (
        await client.query(
          "select count(*)::int as count from gallery_copy_source_retention where source_version_id = 'version-2' and released_at is null",
        )
      ).rows[0].count,
    ).toBe(1);
    await client.query(
      "insert into artifact_gallery_provenance (artifact_id, immediate_listing_id, immediate_listing_revision, immediate_version_id, root_listing_id, root_version_id, root_creator_profile_id, copy_job_id) values ('artifact-copy', 'listing-2', 3, 'version-2', 'listing-2', 'version-2', 'profile-2', 'copy-job-1')",
    );
    await expect(
      client.query(
        "update artifact_gallery_provenance set root_listing_id = 'listing-open' where artifact_id = 'artifact-copy'",
      ),
    ).rejects.toThrow("immutable");
  });

  it("propagates and reverses source-linked governance without matching independent uploads", async () => {
    const governance = new GalleryGovernanceService(quotaPool);
    await client.query(
      "insert into gallery_governance_case (id,case_kind,listing_id,artifact_id,evidence_snapshot,evidence_digest) values ('case-restrict','report','listing-2','artifact-2','{}','evidence-restrict')",
    );
    const restricted = await governance.decide({
      actorUserId: "owner-1",
      caseId: "case-restrict",
      kind: "restrict",
      ruleCode: "serious_malware",
      rationale: "Confirmed malicious behavior",
      idempotencyKey: "restrict-artifact-2",
      expectedListingRevision: 5,
    });
    const restrictions = await client.query(
      "select artifact_id,source_root_decision_id,state from gallery_public_sharing_restriction order by artifact_id",
    );
    expect(restrictions.rows).toEqual([
      {
        artifact_id: "artifact-2",
        source_root_decision_id: restricted.decisionId,
        state: "active",
      },
      {
        artifact_id: "artifact-copy",
        source_root_decision_id: restricted.decisionId,
        state: "active",
      },
    ]);
    expect(
      restrictions.rows.some(({ artifact_id }) => artifact_id === "artifact-1"),
    ).toBe(false);

    const appeal = await governance.appeal({
      userId: "owner-2",
      decisionId: restricted.decisionId,
      statement: "Please review this restriction",
      idempotencyKey: "appeal-restriction",
    });
    expect(appeal.appealId).toMatch(/^gappeal_/);
    await expect(
      governance.appeal({
        userId: "owner-2",
        decisionId: restricted.decisionId,
        statement: "A different duplicate",
        idempotencyKey: "appeal-restriction-2",
      }),
    ).rejects.toMatchObject({ code: "appeal_unavailable" });

    await client.query(
      "insert into gallery_governance_case (id,case_kind,listing_id,artifact_id,evidence_snapshot,evidence_digest) values ('case-clear','restriction','listing-2','artifact-2','{}','evidence-clear')",
    );
    await governance.decide({
      actorUserId: "owner-1",
      caseId: "case-clear",
      kind: "clear_restriction",
      ruleCode: "review_complete",
      rationale: "The restriction basis was reversed",
      idempotencyKey: "clear-artifact-2",
      expectedListingRevision: 5,
    });
    expect(
      (
        await client.query(
          "select distinct state from gallery_public_sharing_restriction",
        )
      ).rows,
    ).toEqual([{ state: "cleared" }]);
    expect(
      (
        await client.query("select state from gallery_appeal where id=$1", [
          appeal.appealId,
        ])
      ).rows[0],
    ).toEqual({ state: "moot" });

    await client.query(
      "update gallery_appeal_policy set active=false where version='appeal/v1'",
    );
    await client.query(
      "insert into gallery_appeal_policy(version,deadline_seconds,active) values('appeal/v2',1209600,true)",
    );
    await client.query(
      "insert into gallery_governance_case(id,case_kind,listing_id,artifact_id,evidence_snapshot,evidence_digest) values('case-takedown','report','listing-2','artifact-2','{}','evidence-takedown')",
    );
    const takedown = await governance.decide({
      actorUserId: "owner-1",
      caseId: "case-takedown",
      kind: "takedown",
      ruleCode: "confirmed_malware",
      rationale: "Confirmed content-level policy violation",
      idempotencyKey: "takedown-artifact-2",
      expectedListingRevision: 5,
    });
    expect(
      (
        await client.query(
          "select appeal_policy_version from gallery_governance_decision where id=$1",
          [takedown.decisionId],
        )
      ).rows[0],
    ).toEqual({ appeal_policy_version: "appeal/v2" });
    const takedownAppeal = await governance.appeal({
      userId: "owner-2",
      decisionId: takedown.decisionId,
      statement: "This takedown should be reconsidered",
      idempotencyKey: "appeal-takedown",
    });
    const appealCaseId = (
      await client.query("select case_id from gallery_appeal where id=$1", [
        takedownAppeal.appealId,
      ])
    ).rows[0].case_id;
    await governance.decide({
      actorUserId: "owner-1",
      caseId: appealCaseId,
      kind: "reverse_appeal",
      ruleCode: "appeal_sustained",
      rationale: "Review found that the takedown should be reversed",
      idempotencyKey: "reverse-takedown-appeal",
      expectedListingRevision: 5,
    });
    expect(
      (
        await client.query(
          "select state from gallery_artifact_takedown where source_decision_id=$1",
          [takedown.decisionId],
        )
      ).rows[0],
    ).toEqual({ state: "reversed" });
    expect(
      (
        await client.query("select state from gallery_appeal where id=$1", [
          takedownAppeal.appealId,
        ])
      ).rows[0],
    ).toEqual({ state: "reversed" });
    expect(
      Number(
        (
          await client.query(
            "select count(*) count from gallery_notification where recipient_user_id='owner-2' and category='appeal_decision'",
          )
        ).rows[0].count,
      ),
    ).toBeGreaterThan(0);
  });

  it("releases due evidence but retains it while an accepted Appeal is pending", async () => {
    await client.query(`insert into gallery_governance_case
      (id,case_kind,artifact_id,state,evidence_snapshot,evidence_digest,closed_at,retention_release_after)
      values ('case-retain-ready','takedown','artifact-1','decided','{}','retain-ready',now(),now()-interval '1 day'),
             ('case-retain-pending','takedown','artifact-1','decided','{}','retain-pending',now(),now()-interval '1 day')`);
    await client.query(`insert into gallery_governance_decision
      (id,case_id,actor_user_id,decision_kind,rule_code,rationale,evidence_digest,appeal_policy_version,
       appeal_deadline_at,idempotency_key_digest,input_fingerprint)
      values ('decision-retain-pending','case-retain-pending','owner-1','takedown','test_rule','Test rationale',
              'retain-pending','appeal/v1',now()-interval '1 day','retain-key','retain-input')`);
    await client.query(`insert into gallery_governance_case
      (id,case_kind,artifact_id,parent_case_id,evidence_snapshot,evidence_digest)
      values ('case-retain-appeal','appeal','artifact-1','case-retain-pending','{}','retain-appeal')`);
    await client.query(`insert into gallery_appeal
      (id,case_id,decision_id,appellant_user_id,policy_version,deadline_at,statement,idempotency_key_digest,input_fingerprint)
      values ('appeal-retain-pending','case-retain-appeal','decision-retain-pending','owner-1','appeal/v1',
              now()-interval '1 day','Accepted before the deadline','retain-appeal-key','retain-appeal-input')`);
    await client.query(`insert into gallery_governance_evidence_hold(id,case_id,object_key,reason_code)
      values ('hold-retain-ready','case-retain-ready','evidence/ready','test'),
             ('hold-retain-pending','case-retain-pending','evidence/pending','test')`);
    const deleted: string[] = [];
    await new GalleryReconciliation(quotaPool, {
      removeStagingPrefix: async () => ({ deletedCount: 0 }),
      deleteObject: async (key) => {
        deleted.push(key);
      },
    }).run();
    expect(deleted).toEqual(["evidence/ready"]);
    expect(
      (
        await client.query(
          "select released_at is not null released from gallery_governance_evidence_hold where id='hold-retain-ready'",
        )
      ).rows[0],
    ).toEqual({ released: true });
    expect(
      (
        await client.query(
          "select released_at is null retained from gallery_governance_evidence_hold where id='hold-retain-pending'",
        )
      ).rows[0],
    ).toEqual({ retained: true });
  });

  it("audits Featured, Removal, dismissal, and rejects restoration after replacement", async () => {
    const governance = new GalleryGovernanceService(quotaPool);
    await client.query(
      "insert into artifact(id,owner_user_id,name) values('artifact-governed','owner-1','Governed Artifact')",
    );
    await client.query(`insert into artifact_upload_session
      (id,artifact_id,policy_revision,archive_size_bytes,expanded_size_bytes,file_count,single_file_size_bytes,formats,raw_object_key,raw_size_bytes,state,owner_user_id)
      values('upload-governed','artifact-governed','policy/v1',100,100,1,100,'[]','raw/governed',100,'committed','owner-1')`);
    await client.query(
      "insert into artifact_version(id,artifact_id,upload_session_id,version_number,state) values('version-governed','artifact-governed','upload-governed',1,'ready')",
    );
    await client.query(
      "insert into gallery_listing(id,artifact_id,owner_user_id,creator_profile_id,opaque_slug) values('listing-governed','artifact-governed','owner-1','profile-1','opaque_slug_governed_item')",
    );
    await client.query(
      "insert into gallery_permission_grant_acceptance(id,user_id,listing_id,grant_version,grant_text_digest) values('grant-governed','owner-1','listing-governed','grant/v1',repeat('d',64))",
    );
    await client.query(
      "insert into gallery_listing_revision(id,listing_id,revision,version_id,permission_acceptance_id,public_title,tags) values('revision-governed','listing-governed',1,'version-governed','grant-governed','Governed',array['demo'])",
    );
    await client.query(
      "update gallery_listing set lifecycle_state='listed',current_revision_id='revision-governed' where id='listing-governed'",
    );
    await governance.setFeatured("owner-1", "listing-governed", 1, 1);
    await client.query(
      "insert into gallery_governance_case(id,case_kind,listing_id,artifact_id,evidence_snapshot,evidence_digest) values('case-remove-governed','report','listing-governed','artifact-governed','{}','remove-governed')",
    );
    await governance.decide({
      actorUserId: "owner-1",
      caseId: "case-remove-governed",
      kind: "remove",
      ruleCode: "community_safety",
      rationale: "Remove after governance review",
      idempotencyKey: "remove-governed",
      expectedListingRevision: 1,
    });
    expect(
      (
        await client.query(
          "select lifecycle_state,closure_reason from gallery_listing where id='listing-governed'",
        )
      ).rows[0],
    ).toEqual({
      lifecycle_state: "removed",
      closure_reason: "administrator_removal",
    });
    expect(
      (
        await client.query(
          "select count(*)::int count from gallery_featured_position where listing_id='listing-governed'",
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await client.query(
          "select action from gallery_featured_audit_event where listing_id='listing-governed' order by created_at",
        )
      ).rows.map(({ action }) => action),
    ).toEqual(["placed", "eligibility_removed"]);

    await client.query(
      "insert into gallery_listing(id,artifact_id,owner_user_id,creator_profile_id,opaque_slug,predecessor_listing_id) values('listing-governed-replacement','artifact-governed','owner-1','profile-1','opaque_slug_governed_new','listing-governed')",
    );
    await client.query(
      "insert into gallery_governance_case(id,case_kind,listing_id,artifact_id,evidence_snapshot,evidence_digest) values('case-restore-governed','removal','listing-governed','artifact-governed','{}','restore-governed')",
    );
    await expect(
      governance.decide({
        actorUserId: "owner-1",
        caseId: "case-restore-governed",
        kind: "restore",
        ruleCode: "removal_reversed",
        rationale: "Attempt restoration after replacement",
        idempotencyKey: "restore-governed",
        expectedListingRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "invalid_decision" });

    await client.query(
      "insert into gallery_governance_case(id,case_kind,listing_id,artifact_id,evidence_snapshot,evidence_digest) values('case-dismiss-governed','report','listing-governed-replacement','artifact-governed','{}','dismiss-governed')",
    );
    await client.query(
      "insert into gallery_review_basis(id,artifact_id,listing_id,case_id,basis_kind) values('basis-dismiss-governed','artifact-governed','listing-governed-replacement','case-dismiss-governed','report')",
    );
    await client.query(
      "update gallery_listing set review_state='reviewing' where id='listing-governed-replacement'",
    );
    await governance.decide({
      actorUserId: "owner-1",
      caseId: "case-dismiss-governed",
      kind: "dismiss",
      ruleCode: "no_violation",
      rationale: "No actionable policy violation",
      idempotencyKey: "dismiss-governed",
      expectedListingRevision: 1,
    });
    expect(
      (
        await client.query(
          "select review_state from gallery_listing where id='listing-governed-replacement'",
        )
      ).rows[0],
    ).toEqual({ review_state: "clear" });
  });

  it("reserves, commits, releases, and reconciles quota exactly once", async () => {
    const accounting = new GalleryQuotaAccounting(quotaPool);
    const first = await accounting.reserve({
      reservationId: "accounting-commit",
      userId: "owner-1",
      artifactCount: 1,
      storageBytes: 123,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(first.kind).toBe("reserved");
    expect(await accounting.commit("accounting-commit")).toBe(true);
    expect(await accounting.commit("accounting-commit")).toBe(false);
    const second = await accounting.reserve({
      reservationId: "accounting-release",
      userId: "owner-1",
      artifactCount: 1,
      storageBytes: 321,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(second.kind).toBe("reserved");
    expect(await accounting.release("accounting-release")).toBe(true);
    expect(await accounting.release("accounting-release")).toBe(false);
    await accounting.reconcile("owner-1");
    const account = (
      await client.query(
        "select artifact_usage, artifact_reserved, storage_bytes_reserved from artifact_storage_quota_account where user_id = 'owner-1'",
      )
    ).rows[0];
    expect(account).toEqual({
      artifact_usage: "2",
      artifact_reserved: "0",
      storage_bytes_reserved: "0",
    });
    await expect(
      client.query(
        "update artifact_storage_quota_policy set artifact_limit = 101 where revision = 'artifact-storage/v1'",
      ),
    ).rejects.toThrow("activate a new revision");
  });
});
