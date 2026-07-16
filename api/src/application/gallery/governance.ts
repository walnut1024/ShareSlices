import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { GalleryAdministratorAuthority } from "./administrator-authority.js";

export type GovernanceDecisionKind =
  | "approve"
  | "reject"
  | "dismiss"
  | "remove"
  | "restore"
  | "restrict"
  | "clear_restriction"
  | "takedown"
  | "clear_takedown"
  | "uphold_appeal"
  | "reverse_appeal";

export class GalleryGovernanceError extends Error {
  constructor(
    readonly code:
      | "case_not_found"
      | "case_closed"
      | "invalid_decision"
      | "decision_conflict"
      | "appeal_forbidden"
      | "appeal_unavailable"
      | "appeal_expired"
      | "invalid_text",
  ) {
    super(code);
  }
}

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function safeText(value: string, maximum = 8000): string {
  const text = value.trim();
  if (
    !text ||
    text.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  ) {
    throw new GalleryGovernanceError("invalid_text");
  }
  return text;
}

export class GalleryGovernanceService {
  constructor(
    private readonly pool: Pool,
    private readonly authority = new GalleryAdministratorAuthority(pool),
  ) {}

  async queue(
    actorUserId: string,
    queue: "proposals" | "reports" | "appeals" | "restrictions" | "takedowns" | "removals",
    cursor?: string,
    limit = 50,
  ) {
    await this.authority.require(actorUserId, "queue_read");
    const caseKind = queue.slice(0, -1);
    const cursorValue = decodeCursor(cursor);
    const { rows } = await this.pool.query(
      `select governance_case.id,governance_case.case_kind,governance_case.state,
              governance_case.evidence_snapshot,governance_case.evidence_digest,
              governance_case.opened_at,governance_case.listing_id,governance_case.artifact_id,
              governance_case.proposal_id,report.category report_category,report.details report_details,
              listing.lifecycle_state,listing.review_state,listing.listing_revision,
              coalesce(proposal.version_id,current_revision.version_id) version_id,
              profile.opaque_slug creator_slug,profile.display_name creator_display_name,
              provenance.immediate_listing_id,provenance.root_listing_id,
              coalesce(prior.decisions,'[]'::jsonb) prior_decisions
       from gallery_governance_case governance_case
       left join gallery_report report on report.id=governance_case.report_id
       left join gallery_listing listing on listing.id=governance_case.listing_id
       left join gallery_listing_proposal proposal on proposal.id=governance_case.proposal_id
       left join gallery_listing_revision current_revision on current_revision.id=listing.current_revision_id
       left join gallery_creator_profile profile on profile.id=listing.creator_profile_id
       left join artifact_gallery_provenance provenance on provenance.artifact_id=governance_case.artifact_id
       left join lateral (
         select jsonb_agg(jsonb_build_object('id',decision.id,'kind',decision.decision_kind,
                'ruleCode',decision.rule_code,'createdAt',decision.created_at) order by decision.created_at) decisions
         from gallery_governance_decision decision
         where decision.case_id=governance_case.id
       ) prior on true
       where governance_case.state='open' and governance_case.case_kind=$1
         and ($2::timestamptz is null or (governance_case.opened_at,governance_case.id)>($2::timestamptz,$3))
       order by governance_case.opened_at,governance_case.id limit $4`,
      [
        caseKind,
        cursorValue?.createdAt ?? null,
        cursorValue?.id ?? "",
        Math.min(Math.max(limit, 1), 100) + 1,
      ],
    );
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const selected = rows.slice(0, boundedLimit);
    const last = selected.at(-1);
    return {
      items: selected.map((record) => ({
        id: String(record.id),
        queue,
        state: String(record.state),
        createdAt: new Date(record.opened_at).toISOString(),
        listingRevision:
          record.listing_revision === null ||
          record.listing_revision === undefined
            ? null
            : Number(record.listing_revision),
      })),
      nextCursor:
        rows.length > boundedLimit && last
          ? encodeCursor({
              createdAt: new Date(last.opened_at).toISOString(),
              id: String(last.id),
            })
          : null,
    };
  }

  async getCase(actorUserId: string, caseId: string) {
    await this.authority.require(actorUserId, "case_read", caseId);
    const { rows } = await this.pool.query(
      `select governance_case.id,governance_case.case_kind,governance_case.state,
              governance_case.evidence_digest,governance_case.opened_at,
              decision.appeal_policy_version,decision.created_at decision_at,
              decision.appeal_deadline_at,listing.listing_revision,
              report.details report_details
       from gallery_governance_case governance_case
       left join gallery_listing listing on listing.id=governance_case.listing_id
       left join gallery_report report on report.id=governance_case.report_id
       left join lateral (
         select appeal_policy_version,created_at,appeal_deadline_at
         from gallery_governance_decision
         where case_id=governance_case.id
         order by created_at desc limit 1
       ) decision on true
       where governance_case.id=$1`,
      [caseId],
    );
    const record = rows[0];
    if (!record) throw new GalleryGovernanceError("case_not_found");
    return {
      case: {
        id: String(record.id),
        queue: `${String(record.case_kind)}s`,
        state: String(record.state),
        createdAt: new Date(record.opened_at).toISOString(),
        listingRevision:
          record.listing_revision === null ||
          record.listing_revision === undefined
            ? null
            : Number(record.listing_revision),
      },
      evidenceDigest: String(record.evidence_digest),
      plainTextEvidence: record.report_details
        ? String(record.report_details)
        : null,
      appealPolicy: record.appeal_policy_version
        ? {
            policyVersion: String(record.appeal_policy_version),
            decisionAt: new Date(record.decision_at).toISOString(),
            deadlineAt: new Date(record.appeal_deadline_at).toISOString(),
          }
        : null,
      allowedDecisions: this.allowedDecisions(String(record.case_kind)),
      preview: "available" as const,
    };
  }

  private allowedDecisions(caseKind: string): GovernanceDecisionKind[] {
    if (caseKind === "report") return ["dismiss", "remove", "restrict", "takedown"];
    if (caseKind === "proposal") return ["approve", "reject", "restrict", "takedown"];
    if (caseKind === "appeal") return ["uphold_appeal", "reverse_appeal"];
    if (caseKind === "removal") return ["restore"];
    if (caseKind === "restriction") return ["clear_restriction"];
    if (caseKind === "takedown") return ["clear_takedown"];
    return [];
  }

  async decide(
    input: Readonly<{
      actorUserId: string;
      caseId: string;
      kind: GovernanceDecisionKind;
      ruleCode: string;
      rationale: string;
      idempotencyKey: string;
      expectedListingRevision: number | null;
    }>,
  ) {
    const rationale = safeText(input.rationale);
    const ruleCode = safeText(input.ruleCode, 200);
    const fingerprint = digest({
      caseId: input.caseId,
      kind: input.kind,
      ruleCode,
      rationale,
      expectedListingRevision: input.expectedListingRevision,
    });
    const keyDigest = digest(input.idempotencyKey);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.authority.require(
        input.actorUserId,
        "decision",
        input.caseId,
        client,
      );
      const replay = (
        await client.query(
          "select id,input_fingerprint from gallery_governance_decision where actor_user_id=$1 and idempotency_key_digest=$2",
          [input.actorUserId, keyDigest],
        )
      ).rows[0];
      if (replay) {
        if (replay.input_fingerprint !== fingerprint)
          throw new GalleryGovernanceError("decision_conflict");
        const response = await this.decisionResponse(client, String(replay.id));
        await client.query("commit");
        return response;
      }
      const governanceCase = (
        await client.query(
          "select * from gallery_governance_case where id=$1 for update",
          [input.caseId],
        )
      ).rows[0];
      if (!governanceCase) throw new GalleryGovernanceError("case_not_found");
      if (governanceCase.state !== "open")
        throw new GalleryGovernanceError("case_closed");
      if (!this.decisionAllowed(governanceCase, input.kind))
        throw new GalleryGovernanceError("invalid_decision");
      if (governanceCase.listing_id) {
        const listing = (
          await client.query(
            "select listing_revision from gallery_listing where id=$1 for update",
            [governanceCase.listing_id],
          )
        ).rows[0];
        if (
          !listing ||
          input.expectedListingRevision === null ||
          Number(listing.listing_revision) !== input.expectedListingRevision
        )
          throw new GalleryGovernanceError("decision_conflict");
      }
      const appealable = ["remove", "restrict", "takedown"].includes(
        input.kind,
      );
      const policy = appealable
        ? (
            await client.query(
              "select version,deadline_seconds from gallery_appeal_policy where active=true for share",
            )
          ).rows[0]
        : null;
      if (appealable && !policy)
        throw new GalleryGovernanceError("invalid_decision");
      const decisionId = `gdecision_${randomUUID()}`;
      await client.query(
        `insert into gallery_governance_decision
         (id,case_id,actor_user_id,decision_kind,rule_code,rationale,evidence_digest,
          appeal_policy_version,appeal_deadline_at,idempotency_key_digest,input_fingerprint)
         values($1,$2,$3,$4,$5,$6,$7,$8,
          case when $9::bigint is null then null else now()+make_interval(secs=>$9::int) end,$10,$11)`,
        [
          decisionId,
          input.caseId,
          input.actorUserId,
          input.kind,
          ruleCode,
          rationale,
          governanceCase.evidence_digest,
          policy?.version ?? null,
          policy?.deadline_seconds ?? null,
          keyDigest,
          fingerprint,
        ],
      );
      await this.applyDecision(
        client,
        governanceCase,
        decisionId,
        input.kind,
        ruleCode,
        input.actorUserId,
      );
      await client.query(
        "update gallery_governance_case set state='decided',closed_at=now() where id=$1",
        [input.caseId],
      );
      const response = await this.decisionResponse(client, decisionId);
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async decisionResponse(client: PoolClient, decisionId: string) {
    const record = (
      await client.query(
        `select decision.id,decision.created_at,decision.appeal_policy_version,
                decision.appeal_deadline_at,governance_case.artifact_id,
                listing.lifecycle_state,listing.review_state,
                exists(select 1 from gallery_public_sharing_restriction restriction
                  where restriction.artifact_id=governance_case.artifact_id and restriction.state='active') restricted,
                exists(select 1 from gallery_artifact_takedown takedown
                  where takedown.artifact_id=governance_case.artifact_id and takedown.state='active') taken_down
         from gallery_governance_decision decision
         join gallery_governance_case governance_case on governance_case.id=decision.case_id
         left join gallery_listing listing on listing.id=governance_case.listing_id
         where decision.id=$1`,
        [decisionId],
      )
    ).rows[0];
    const restrictions: string[] = [];
    if (record.lifecycle_state !== "listed") restrictions.push("not_listed");
    if (record.review_state === "restricted" || record.restricted)
      restrictions.push("public_sharing_restricted");
    if (record.taken_down) restrictions.push("artifact_takedown");
    const committedAt = new Date(record.created_at).toISOString();
    return {
      decisionId: String(record.id),
      committedAt,
      policy: record.appeal_policy_version
        ? {
            policyVersion: String(record.appeal_policy_version),
            decisionAt: committedAt,
            deadlineAt: new Date(record.appeal_deadline_at).toISOString(),
          }
        : null,
      effectiveAccess: {
        accessible: restrictions.length === 0,
        restrictions,
      },
    };
  }

  private decisionAllowed(
    governanceCase: Record<string, unknown>,
    kind: GovernanceDecisionKind,
  ): boolean {
    return this.allowedDecisions(String(governanceCase.case_kind)).includes(kind);
  }

  private async applyDecision(
    client: PoolClient,
    governanceCase: Record<string, unknown>,
    decisionId: string,
    kind: GovernanceDecisionKind,
    ruleCode: string,
    actorUserId: string,
  ) {
    const artifactId = governanceCase.artifact_id as string | null;
    const listingId = governanceCase.listing_id as string | null;
    if (kind === "dismiss") {
      await client.query(
        "update gallery_review_basis set state='closed',ended_at=now(),ending_decision_id=$2 where case_id=$1 and state='active'",
        [governanceCase.id, decisionId],
      );
    } else if (kind === "remove" && listingId) {
      const result = await client.query(
        "update gallery_listing set lifecycle_state='removed',review_state='clear',closure_reason='administrator_removal',listing_revision=listing_revision+1,closed_at=now(),updated_at=now() where id=$1 and lifecycle_state='listed' and current_revision_id is not null",
        [listingId],
      );
      if (result.rowCount !== 1)
        throw new GalleryGovernanceError("invalid_decision");
      await client.query(
        `insert into gallery_listing_lifecycle_event
         (id,listing_id,from_lifecycle_state,to_lifecycle_state,closure_reason,committed_listing_revision,actor_kind,actor_id)
         select $1,id,'listed','removed','administrator_removal',listing_revision,'administrator',$2
         from gallery_listing where id=$3`,
        [`glevent_${randomUUID()}`, actorUserId, listingId],
      );
      await client.query(
        `insert into gallery_listing_closure_tombstone
         (listing_id,opaque_slug,was_ever_public,terminal_lifecycle_state,closure_reason)
         select id,opaque_slug,true,'removed','administrator_removal' from gallery_listing where id=$1
         on conflict(listing_id) do nothing`,
        [listingId],
      );
    } else if (kind === "restore" && listingId) {
      const result = await client.query(
        `update gallery_listing listing set lifecycle_state='listed',review_state='clear',closure_reason=null,
          listing_revision=listing_revision+1,closed_at=null,updated_at=now()
         where id=$1 and lifecycle_state='removed' and closure_reason='administrator_removal'
         and restoration_forfeited_at is null and not exists(
           select 1 from gallery_listing replacement where replacement.artifact_id=listing.artifact_id
             and replacement.id<>listing.id and replacement.created_at>listing.closed_at)`,
        [listingId],
      );
      if (result.rowCount !== 1)
        throw new GalleryGovernanceError("invalid_decision");
      await client.query(
        `insert into gallery_listing_lifecycle_event
         (id,listing_id,from_lifecycle_state,to_lifecycle_state,committed_listing_revision,actor_kind,actor_id)
         select $1,id,'removed','listed',listing_revision,'administrator',$2 from gallery_listing where id=$3`,
        [`glevent_${randomUUID()}`, actorUserId, listingId],
      );
    } else if (kind === "restrict" && artifactId) {
      await client.query(
        "insert into gallery_public_sharing_restriction(id,artifact_id,source_decision_id,source_root_decision_id,rule_code) values($1,$2,$3,$3,$4)",
        [`grestrict_${randomUUID()}`, artifactId, decisionId, ruleCode],
      );
      await client.query(
        "insert into gallery_review_basis(id,artifact_id,listing_id,case_id,basis_kind,source_decision_id,source_root_decision_id) values($1,$2,$3,$4,'restriction',$5,$5)",
        [
          `gbasis_${randomUUID()}`,
          artifactId,
          listingId,
          governanceCase.id,
          decisionId,
        ],
      );
      await this.propagateRestriction(client, artifactId, decisionId, ruleCode);
      await this.closeBlockedProposals(client, artifactId, decisionId);
    } else if (kind === "clear_restriction" && artifactId) {
      await client.query(
        "update gallery_public_sharing_restriction set state='cleared',ended_at=now(),ending_decision_id=$2 where artifact_id=$1 and state='active'",
        [artifactId, decisionId],
      );
      await client.query(
        "update gallery_public_sharing_restriction set state='cleared',ended_at=now(),ending_decision_id=$2 where source_root_decision_id in (select source_root_decision_id from gallery_public_sharing_restriction where artifact_id=$1 and ending_decision_id=$2) and state='active'",
        [artifactId, decisionId],
      );
      await this.closeDerivedBasesAndRecompute(client, decisionId, "closed");
    } else if (kind === "takedown" && artifactId) {
      await client.query(
        "insert into gallery_artifact_takedown(id,artifact_id,source_decision_id,source_root_decision_id,rule_code) values($1,$2,$3,$3,$4)",
        [`gtakedown_${randomUUID()}`, artifactId, decisionId, ruleCode],
      );
      await client.query(
        "insert into gallery_review_basis(id,artifact_id,listing_id,case_id,basis_kind,source_decision_id,source_root_decision_id) values($1,$2,$3,$4,'takedown',$5,$5)",
        [
          `gbasis_${randomUUID()}`,
          artifactId,
          listingId,
          governanceCase.id,
          decisionId,
        ],
      );
      await this.propagateRestriction(client, artifactId, decisionId, ruleCode);
      await this.closeBlockedProposals(client, artifactId, decisionId);
    } else if (kind === "clear_takedown" && artifactId) {
      await client.query(
        "update gallery_artifact_takedown set state='cleared',ended_at=now(),ending_decision_id=$2 where artifact_id=$1 and state='active'",
        [artifactId, decisionId],
      );
      await this.closeDerivedBasesAndRecompute(client, decisionId, "closed");
    } else if (
      (kind === "uphold_appeal" || kind === "reverse_appeal") &&
      governanceCase.parent_case_id
    ) {
      await this.resolveAppeal(client, governanceCase, decisionId, kind);
    }
    if (artifactId) await this.recomputeArtifact(client, artifactId);
    if (listingId)
      await this.removeFeaturedIfIneligible(
        client,
        listingId,
        actorUserId,
        decisionId,
      );
    if (["remove", "restrict", "takedown"].includes(kind)) {
      const recipient = (
        await client.query(
          "select owner_user_id from gallery_listing where id=$1",
          [listingId],
        )
      ).rows[0]?.owner_user_id;
      if (recipient)
        await client.query(
          `insert into gallery_notification(id,recipient_user_id,case_id,decision_id,category,rule_code,current_effect,appeal_policy_version,appeal_deadline_at)
         select $1,$2,$3,id,$4,$5,$6,appeal_policy_version,appeal_deadline_at from gallery_governance_decision where id=$7`,
          [
            `gnotification_${randomUUID()}`,
            recipient,
            governanceCase.id,
            kind === "remove"
              ? "removal"
              : kind === "restrict"
                ? "public_sharing_restriction"
                : "artifact_takedown",
            ruleCode,
            kind,
            decisionId,
          ],
        );
    }
  }

  private async closeDerivedBasesAndRecompute(
    client: PoolClient,
    endingDecisionId: string,
    state: "closed" | "reversed",
  ) {
    await client.query(
      `insert into gallery_notification(id,recipient_user_id,case_id,decision_id,category,rule_code,current_effect)
       select 'gnotification_'||gen_random_uuid()::text,appeal.appellant_user_id,appeal.case_id,$1,
              'appeal_decision','direct_reversal','The challenged decision is no longer in force; the Appeal is moot.'
       from gallery_appeal appeal where appeal.state='pending' and appeal.decision_id in (
         select source_root_decision_id from gallery_public_sharing_restriction where ending_decision_id=$1
         union select source_root_decision_id from gallery_artifact_takedown where ending_decision_id=$1
       )`,
      [endingDecisionId],
    );
    await client.query(
      `update gallery_appeal set state=$2,resolved_at=now(),resolution_decision_id=$1
       where state='pending' and decision_id in (
         select source_root_decision_id from gallery_public_sharing_restriction where ending_decision_id=$1
         union select source_root_decision_id from gallery_artifact_takedown where ending_decision_id=$1
       )`,
      [endingDecisionId, state === "reversed" ? "reversed" : "moot"],
    );
    const { rows } = await client.query(
      `update gallery_review_basis basis set state=$2,ended_at=now(),ending_decision_id=$1
       where source_root_decision_id in (
         select source_root_decision_id from gallery_public_sharing_restriction where ending_decision_id=$1
         union select source_root_decision_id from gallery_artifact_takedown where ending_decision_id=$1
       ) and state='active' returning artifact_id`,
      [endingDecisionId, state],
    );
    for (const row of rows)
      await this.recomputeArtifact(client, String(row.artifact_id));
  }

  private async propagateRestriction(
    client: PoolClient,
    sourceArtifactId: string,
    sourceDecisionId: string,
    ruleCode: string,
  ) {
    await client.query(
      `insert into gallery_public_sharing_restriction
         (id,artifact_id,source_decision_id,source_root_decision_id,rule_code)
       select 'grestrict_'||gen_random_uuid()::text,copy.artifact_id,$2,$2,$3
       from gallery_listing source
       join gallery_listing_revision source_revision on source_revision.id=source.current_revision_id
       join artifact_gallery_provenance copy on
         (copy.immediate_listing_id=source.id and copy.immediate_version_id=source_revision.version_id)
         or (copy.root_listing_id=source.id and copy.root_version_id=source_revision.version_id)
       where source.artifact_id=$1
       on conflict do nothing`,
      [sourceArtifactId, sourceDecisionId, ruleCode],
    );
    await client.query(
      `insert into gallery_review_basis(id,artifact_id,listing_id,case_id,basis_kind,source_decision_id,source_root_decision_id)
       select 'gbasis_'||gen_random_uuid()::text,restriction.artifact_id,listing.id,decision.case_id,'restriction',$1,$1
       from gallery_public_sharing_restriction restriction
       join gallery_governance_decision decision on decision.id=$1
       left join gallery_listing listing on listing.artifact_id=restriction.artifact_id and listing.lifecycle_state in ('pending','listed')
       where restriction.source_root_decision_id=$1
       and not exists(select 1 from gallery_review_basis basis where basis.artifact_id=restriction.artifact_id and basis.source_root_decision_id=$1 and basis.state='active')`,
      [sourceDecisionId],
    );
    await client.query(
      "update gallery_listing set review_state='restricted',updated_at=now() where artifact_id in (select artifact_id from gallery_public_sharing_restriction where source_root_decision_id=$1 and state='active') and lifecycle_state in ('pending','listed')",
      [sourceDecisionId],
    );
  }

  private async closeBlockedProposals(
    client: PoolClient,
    artifactId: string,
    decisionId: string,
  ) {
    await client.query(
      `update gallery_listing_proposal proposal set state='governance_blocked',closed_at=now()
       from gallery_listing listing where proposal.listing_id=listing.id and listing.artifact_id=$1 and proposal.state='open'`,
      [artifactId],
    );
    await client.query(
      `update gallery_listing set lifecycle_state='removed',closure_reason='initial_governance_block',closed_at=now(),
         listing_revision=listing_revision+1,updated_at=now()
       where artifact_id=$1 and lifecycle_state='pending' and current_revision_id is null`,
      [artifactId],
    );
    await client.query(
      `insert into gallery_listing_lifecycle_event
         (id,listing_id,from_lifecycle_state,to_lifecycle_state,closure_reason,committed_listing_revision,actor_kind,actor_id)
       select 'glevent_'||gen_random_uuid()::text,id,'pending','removed','initial_governance_block',listing_revision,'administrator',$2
       from gallery_listing where artifact_id=$1 and lifecycle_state='removed' and closure_reason='initial_governance_block'
       on conflict do nothing`,
      [artifactId, decisionId],
    );
    await client.query(
      `insert into gallery_listing_closure_tombstone
         (listing_id,opaque_slug,was_ever_public,terminal_lifecycle_state,closure_reason)
       select id,opaque_slug,false,'removed','initial_governance_block' from gallery_listing
       where artifact_id=$1 and lifecycle_state='removed' and closure_reason='initial_governance_block'
       on conflict(listing_id) do nothing`,
      [artifactId],
    );
  }

  private async resolveAppeal(
    client: PoolClient,
    governanceCase: Record<string, unknown>,
    decisionId: string,
    kind: "uphold_appeal" | "reverse_appeal",
  ) {
    const appeal = (
      await client.query(
        "select * from gallery_appeal where case_id=$1 and state='pending' for update",
        [governanceCase.id],
      )
    ).rows[0];
    if (!appeal) throw new GalleryGovernanceError("invalid_decision");
    await client.query(
      "update gallery_appeal set state=$2,resolved_at=now(),resolution_decision_id=$3 where id=$1",
      [appeal.id, kind === "uphold_appeal" ? "upheld" : "reversed", decisionId],
    );
    await client.query(
      "insert into gallery_notification(id,recipient_user_id,case_id,decision_id,category,rule_code,current_effect) values($1,$2,$3,$4,'appeal_decision',$5,$6)",
      [
        `gnotification_${randomUUID()}`,
        appeal.appellant_user_id,
        appeal.case_id,
        decisionId,
        kind,
        kind === "uphold_appeal"
          ? "The challenged decision remains in force; no further Gallery Appeal is available."
          : "The challenged decision was reversed; access will be recomputed from remaining governance bases.",
      ],
    );
    if (kind === "reverse_appeal") {
      const reversedRestrictions = await client.query(
        "update gallery_public_sharing_restriction set state='reversed',ended_at=now(),ending_decision_id=$2 where source_decision_id=$1 and state='active' returning artifact_id",
        [appeal.decision_id, decisionId],
      );
      await client.query(
        "update gallery_artifact_takedown set state='reversed',ended_at=now(),ending_decision_id=$2 where source_decision_id=$1 and state='active'",
        [appeal.decision_id, decisionId],
      );
      await client.query(
        "update gallery_review_basis set state='reversed',ended_at=now(),ending_decision_id=$2 where source_root_decision_id=$1 and state='active'",
        [appeal.decision_id, decisionId],
      );
      for (const row of reversedRestrictions.rows)
        await this.recomputeArtifact(client, String(row.artifact_id));
    }
  }

  private async recomputeArtifact(client: PoolClient, artifactId: string) {
    await client.query(
      `update gallery_listing listing set review_state=case
         when exists(select 1 from gallery_public_sharing_restriction where artifact_id=$1 and state='active') then 'restricted'
         when exists(select 1 from gallery_review_basis where artifact_id=$1 and state='active')
           or exists(select 1 from gallery_artifact_takedown where artifact_id=$1 and state='active') then 'reviewing'
         else 'clear' end,updated_at=now()
       where listing.artifact_id=$1 and listing.lifecycle_state in ('pending','listed')`,
      [artifactId],
    );
  }

  private async removeFeaturedIfIneligible(
    client: PoolClient,
    listingId: string,
    actorUserId: string | null,
    decisionId: string,
  ) {
    const removed = (
      await client.query(
        `delete from gallery_featured_position featured using gallery_listing listing
       where featured.listing_id=$1 and listing.id=featured.listing_id
       and (listing.lifecycle_state<>'listed' or listing.review_state not in ('clear','reviewing')
         or exists(select 1 from gallery_artifact_takedown where artifact_id=listing.artifact_id and state='active'))
       returning featured.position`,
        [listingId],
      )
    ).rows[0];
    if (removed)
      await client.query(
        "insert into gallery_featured_audit_event(id,actor_user_id,listing_id,position,action,reason_code) values($1,$2,$3,$4,'eligibility_removed',$5)",
        [
          `gfeaturedaudit_${randomUUID()}`,
          actorUserId,
          listingId,
          removed.position,
          `decision:${decisionId}`,
        ],
      );
  }

  async appeal(
    input: Readonly<{
      userId: string;
      decisionId: string;
      statement: string;
      idempotencyKey: string;
    }>,
  ) {
    const statement = safeText(input.statement);
    const keyDigest = digest(input.idempotencyKey);
    const fingerprint = digest({ decisionId: input.decisionId, statement });
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const decision = (
        await client.query(
          `select decision.*,c.listing_id,c.artifact_id,
                  coalesce(l.owner_user_id,a.owner_user_id) owner_user_id,
                  exists(select 1 from gallery_public_sharing_restriction r where r.source_decision_id=decision.id and r.state='active')
                    or exists(select 1 from gallery_artifact_takedown t where t.source_decision_id=decision.id and t.state='active')
                    or (decision.decision_kind='remove' and l.lifecycle_state='removed' and l.closure_reason='administrator_removal') in_force
           from gallery_governance_decision decision
           join gallery_governance_case c on c.id=decision.case_id
           left join gallery_listing l on l.id=c.listing_id
           left join artifact a on a.id=c.artifact_id
           where decision.id=$1 for update of decision`,
          [input.decisionId],
        )
      ).rows[0];
      if (!decision || !decision.appeal_policy_version)
        throw new GalleryGovernanceError("appeal_unavailable");
      if (!decision.in_force)
        throw new GalleryGovernanceError("appeal_unavailable");
      if (decision.owner_user_id !== input.userId)
        throw new GalleryGovernanceError("appeal_forbidden");
      if (new Date(decision.appeal_deadline_at).getTime() <= Date.now())
        throw new GalleryGovernanceError("appeal_expired");
      const replay = (
        await client.query(
          "select id,input_fingerprint from gallery_appeal where appellant_user_id=$1 and idempotency_key_digest=$2",
          [input.userId, keyDigest],
        )
      ).rows[0];
      if (replay) {
        if (replay.input_fingerprint !== fingerprint)
          throw new GalleryGovernanceError("decision_conflict");
        await client.query("commit");
        return {
          appealId: String(replay.id),
          state: "pending" as const,
          policy: {
            policyVersion: String(decision.appeal_policy_version),
            decisionAt: new Date(decision.created_at).toISOString(),
            deadlineAt: new Date(decision.appeal_deadline_at).toISOString(),
          },
        };
      }
      if (
        (
          await client.query(
            "select 1 from gallery_appeal where decision_id=$1 and appellant_user_id=$2",
            [input.decisionId, input.userId],
          )
        ).rowCount
      )
        throw new GalleryGovernanceError("appeal_unavailable");
      const appealId = `gappeal_${randomUUID()}`;
      const appealCaseId = `gcase_${randomUUID()}`;
      const evidenceSnapshot = {
        challengedDecisionId: input.decisionId,
        policyVersion: decision.appeal_policy_version,
        deadlineAt: decision.appeal_deadline_at,
        statement,
      };
      await client.query(
        `insert into gallery_governance_case
         (id,case_kind,listing_id,artifact_id,parent_case_id,evidence_snapshot,evidence_digest)
         values($1,'appeal',$2,$3,$4,$5,$6)`,
        [
          appealCaseId,
          decision.listing_id,
          decision.artifact_id,
          decision.case_id,
          evidenceSnapshot,
          digest(evidenceSnapshot),
        ],
      );
      const { rows } = await client.query(
        `insert into gallery_appeal(id,case_id,decision_id,appellant_user_id,policy_version,deadline_at,statement,idempotency_key_digest,input_fingerprint)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,input_fingerprint`,
        [
          appealId,
          appealCaseId,
          input.decisionId,
          input.userId,
          decision.appeal_policy_version,
          decision.appeal_deadline_at,
          statement,
          keyDigest,
          fingerprint,
        ],
      );
      if (rows[0]?.input_fingerprint !== fingerprint)
        throw new GalleryGovernanceError("decision_conflict");
      await client.query("commit");
      return {
        appealId: String(rows[0].id),
        state: "pending" as const,
        policy: {
          policyVersion: String(decision.appeal_policy_version),
          decisionAt: new Date(decision.created_at).toISOString(),
          deadlineAt: new Date(decision.appeal_deadline_at).toISOString(),
        },
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async notifications(userId: string, cursor?: string, limit = 50) {
    const cursorValue = decodeCursor(cursor);
    const { rows } = await this.pool.query(
      `select notification.id,notification.category,notification.rule_code,
              notification.current_effect,notification.appeal_policy_version,
              notification.appeal_deadline_at,notification.created_at,
              decision.created_at decision_at
       from gallery_notification notification
       left join gallery_governance_decision decision on decision.id=notification.decision_id
       where notification.recipient_user_id=$1
         and ($2::timestamptz is null or (notification.created_at,notification.id)<($2::timestamptz,$3))
       order by notification.created_at desc,notification.id desc limit $4`,
      [
        userId,
        cursorValue?.createdAt ?? null,
        cursorValue?.id ?? "",
        Math.min(Math.max(limit, 1), 100) + 1,
      ],
    );
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const selected = rows.slice(0, boundedLimit);
    const last = selected.at(-1);
    return {
      items: selected.map((record) => ({
        id: String(record.id),
        category: String(record.category),
        rule: String(record.rule_code),
        currentEffect: String(record.current_effect),
        appeal: record.appeal_policy_version
          ? {
              policyVersion: String(record.appeal_policy_version),
              decisionAt: new Date(
                record.decision_at ?? record.created_at,
              ).toISOString(),
              deadlineAt: new Date(record.appeal_deadline_at).toISOString(),
            }
          : null,
        createdAt: new Date(record.created_at).toISOString(),
      })),
      nextCursor:
        rows.length > boundedLimit && last
          ? encodeCursor({
              createdAt: new Date(last.created_at).toISOString(),
              id: String(last.id),
            })
          : null,
    };
  }

  async setFeatured(
    actorUserId: string,
    listingId: string,
    position: number,
    expectedListingRevision: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.authority.require(
        actorUserId,
        "featured_change",
        listingId,
        client,
      );
      const result = await client.query(
        `insert into gallery_featured_position(position,listing_id,set_by_user_id,listing_revision)
         select $1,listing.id,$2,listing.listing_revision from gallery_listing listing
         where listing.id=$3 and listing.listing_revision=$4 and listing.lifecycle_state='listed' and listing.review_state in ('clear','reviewing')
           and not exists(select 1 from gallery_artifact_takedown where artifact_id=listing.artifact_id and state='active')
         on conflict(position) do update set listing_id=excluded.listing_id,set_by_user_id=excluded.set_by_user_id,
           listing_revision=excluded.listing_revision,updated_at=now() returning listing_id`,
        [position, actorUserId, listingId, expectedListingRevision],
      );
      if (result.rowCount !== 1)
        throw new GalleryGovernanceError("invalid_decision");
      await client.query(
        "insert into gallery_featured_audit_event(id,actor_user_id,listing_id,position,action,reason_code) values($1,$2,$3,$4,'placed','administrator_selection')",
        [`gfeaturedaudit_${randomUUID()}`, actorUserId, listingId, position],
      );
      await client.query("commit");
      return { position, listingId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeFeatured(actorUserId: string, position: number) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.authority.require(
        actorUserId,
        "featured_change",
        String(position),
        client,
      );
      const removed = (
        await client.query(
          "delete from gallery_featured_position where position=$1 returning listing_id",
          [position],
        )
      ).rows[0];
      if (removed)
        await client.query(
          "insert into gallery_featured_audit_event(id,actor_user_id,listing_id,position,action,reason_code) values($1,$2,$3,$4,'removed','administrator_removal')",
          [
            `gfeaturedaudit_${randomUUID()}`,
            actorUserId,
            removed.listing_id,
            position,
          ],
        );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(
  value?: string,
): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return typeof parsed.createdAt === "string" && typeof parsed.id === "string"
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}
