import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ChallengeVerifier } from "./challenge-verifier.js";
export const galleryReportCategories = [
  "malware",
  "abuse",
  "copyright",
  "privacy",
  "other",
] as const;
export type GalleryReportCategory = (typeof galleryReportCategories)[number];
export class GalleryReportError extends Error {
  constructor(
    readonly code:
      | "challenge_rejected"
      | "challenge_unavailable"
      | "rate_limited"
      | "not_found"
      | "invalid_report",
  ) {
    super(code);
  }
}
export class GalleryReportService {
  constructor(
    private readonly pool: Pool,
    private readonly verifier: ChallengeVerifier,
  ) {}
  async submit(
    input: Readonly<{
      slug: string;
      category: GalleryReportCategory;
      detail: string;
      challengeToken?: string;
      remoteIp: string;
      reporterUserId: string | null;
    }>,
  ): Promise<{ reportId: string }> {
    const detail = input.detail.trim();
    if (
      !detail ||
      detail.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(detail)
    )
      throw new GalleryReportError("invalid_report");
    if (!input.reporterUserId) {
      const verification = await this.verifier.verify({
        token: input.challengeToken ?? "",
        remoteIp: input.remoteIp,
        expectedAction: "gallery-report",
      });
      if (!verification.success)
        throw new GalleryReportError(
          verification.reasonCode === "unavailable"
            ? "challenge_unavailable"
            : "challenge_rejected",
        );
    }
    const reporterKey = createHash("sha256")
      .update(input.reporterUserId ?? input.remoteIp)
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const recent = Number(
        (
          await client.query(
            "select count(*) count from gallery_privacy_retention_record where record_kind='reporter_signal' and subject_key=$1 and created_at>now()-interval '1 hour'",
            [reporterKey],
          )
        ).rows[0]?.count ?? 0,
      );
      if (recent >= 10) throw new GalleryReportError("rate_limited");
      const listing = (
        await client.query(
          `select listing.id,listing.listing_revision,listing.artifact_id,revision.version_id from gallery_listing listing join gallery_listing_revision revision on revision.id=listing.current_revision_id where listing.opaque_slug=$1 and listing.lifecycle_state='listed' and listing.review_state in ('clear','reviewing') and not exists(select 1 from gallery_public_sharing_restriction where artifact_id=listing.artifact_id and state='active') and not exists(select 1 from gallery_artifact_takedown where artifact_id=listing.artifact_id and state='active') for share of listing`,
          [input.slug],
        )
      ).rows[0];
      if (!listing) throw new GalleryReportError("not_found");
      const reportId = `greport_${randomUUID()}`,
        caseId = `gcase_${randomUUID()}`;
      const snapshot = {
        listingId: listing.id,
        listingRevision: Number(listing.listing_revision),
        versionId: listing.version_id,
        category: input.category,
        detail,
      };
      const digest = createHash("sha256")
        .update(JSON.stringify(snapshot))
        .digest("hex");
      await client.query(
        "insert into gallery_report(id,listing_id,listing_revision,category,details,reporter_actor_hash,challenge_evidence_digest) values($1,$2,$3,$4,$5,$6,$7)",
        [
          reportId,
          listing.id,
          listing.listing_revision,
          input.category,
          detail,
          reporterKey,
          digest,
        ],
      );
      await client.query(
        "insert into gallery_governance_case(id,case_kind,listing_id,artifact_id,report_id,evidence_snapshot,evidence_digest) values($1,'report',$2,$3,$4,$5,$6)",
        [caseId, listing.id, listing.artifact_id, reportId, snapshot, digest],
      );
      await client.query(
        "insert into gallery_governance_evidence_hold(id,case_id,object_key,reason_code) values($1,$2,$3,'active_report')",
        [`ghold_${randomUUID()}`, caseId, `evidence/${digest}`],
      );
      await client.query(
        "insert into gallery_review_basis(id,artifact_id,listing_id,case_id,basis_kind) values($1,$2,$3,$4,'report')",
        [`gbasis_${randomUUID()}`, listing.artifact_id, listing.id, caseId],
      );
      await client.query(
        "update gallery_listing set review_state='reviewing',updated_at=now() where id=$1 and review_state='clear'",
        [listing.id],
      );
      await client.query(
        "insert into gallery_privacy_retention_record(id,record_kind,subject_key,retained_until) values($1,'reporter_signal',$2,now()+interval '30 days')",
        [`gprivacy_${randomUUID()}`, reporterKey],
      );
      await client.query("commit");
      return { reportId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
