import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg, { type Pool } from "pg";

type GalleryGrantContract = Readonly<{
  version: string;
  permissions: string[];
  exactText: string;
  requiresRenewalOnNextProposal: boolean;
}>;

type GalleryAppealContract = Readonly<{
  version: string;
  deadlineSeconds: number;
}>;

export type GalleryLocalBootstrapResult = Readonly<{
  administratorUserId: string;
  grantVersion: string;
  appealPolicyVersion: string;
}>;

const defaultPolicyDirectory = fileURLToPath(
  new URL("../../../db/contracts/gallery-policy/", import.meta.url),
);

async function readContract<T>(directory: string, name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, pathToFileURL(`${directory}/`)), "utf8")) as T;
}

export async function bootstrapLocalGallery(input: Readonly<{
  pool: Pick<Pool, "connect">;
  administratorUserId: string;
  nodeEnv: string | undefined;
  policyDirectory?: string;
}>): Promise<GalleryLocalBootstrapResult> {
  if (input.nodeEnv !== "development" && input.nodeEnv !== "test") {
    throw new Error("Local Gallery bootstrap requires development or test mode.");
  }
  if (!input.administratorUserId.trim()) {
    throw new Error("An explicit administrator User ID is required.");
  }

  const policyDirectory = input.policyDirectory ?? defaultPolicyDirectory;
  const grant = await readContract<GalleryGrantContract>(
    policyDirectory,
    "gallery-permission-grant-v1.json",
  );
  const appeal = await readContract<GalleryAppealContract>(
    policyDirectory,
    "gallery-appeal-policy-v1.json",
  );
  const grantDigest = createHash("sha256").update(grant.exactText).digest("hex");
  const client = await input.pool.connect();

  try {
    await client.query("begin");
    const user = await client.query(
      'select id from "user" where id=$1 for update',
      [input.administratorUserId],
    );
    if (user.rowCount !== 1) {
      throw new Error(`Administrator User ID does not exist: ${input.administratorUserId}`);
    }

    await client.query(
      `insert into gallery_permission_grant
       (version,exact_text,text_digest,permissions,requires_renewal_on_next_proposal,active)
       values($1,$2,$3,$4,$5,false) on conflict(version) do nothing`,
      [
        grant.version,
        grant.exactText,
        grantDigest,
        grant.permissions,
        grant.requiresRenewalOnNextProposal,
      ],
    );
    const installedGrant = (
      await client.query(
        `select exact_text,text_digest,permissions,requires_renewal_on_next_proposal
         from gallery_permission_grant where version=$1`,
        [grant.version],
      )
    ).rows[0];
    if (
      !installedGrant ||
      installedGrant.exact_text !== grant.exactText ||
      installedGrant.text_digest !== grantDigest ||
      JSON.stringify(installedGrant.permissions) !== JSON.stringify(grant.permissions) ||
      installedGrant.requires_renewal_on_next_proposal !==
        grant.requiresRenewalOnNextProposal
    ) {
      throw new Error(`Installed Gallery permission grant does not match ${grant.version}.`);
    }
    await client.query(
      "update gallery_permission_grant set active=false where active and version<>$1",
      [grant.version],
    );
    await client.query(
      "update gallery_permission_grant set active=true where version=$1 and not active",
      [grant.version],
    );

    await client.query(
      `insert into gallery_appeal_policy(version,deadline_seconds,max_appeals,active)
       values($1,$2,1,false) on conflict(version) do nothing`,
      [appeal.version, appeal.deadlineSeconds],
    );
    const installedAppeal = (
      await client.query(
        "select deadline_seconds,max_appeals from gallery_appeal_policy where version=$1",
        [appeal.version],
      )
    ).rows[0];
    if (
      !installedAppeal ||
      Number(installedAppeal.deadline_seconds) !== appeal.deadlineSeconds ||
      installedAppeal.max_appeals !== 1
    ) {
      throw new Error(`Installed Gallery Appeal policy does not match ${appeal.version}.`);
    }
    await client.query(
      "update gallery_appeal_policy set active=false where active and version<>$1",
      [appeal.version],
    );
    await client.query(
      "update gallery_appeal_policy set active=true where version=$1 and not active",
      [appeal.version],
    );

    const authority = (
      await client.query(
        "select revoked_at from gallery_administrator_authority where user_id=$1 for update",
        [input.administratorUserId],
      )
    ).rows[0] as { revoked_at: Date | null } | undefined;
    if (!authority || authority.revoked_at) {
      await client.query(
        `insert into gallery_administrator_authority(user_id,granted_by_user_id)
         values($1,$1) on conflict(user_id) do update set
         revoked_at=null,granted_by_user_id=$1,granted_at=now(),revision=gallery_administrator_authority.revision+1`,
        [input.administratorUserId],
      );
      await client.query(
        `insert into gallery_administrator_audit_event
         (id,actor_user_id,subject_user_id,action,resource_id)
         values($1,$2,$2,'grant','local-bootstrap')`,
        [`gadminaudit_${randomUUID()}`, input.administratorUserId],
      );
    }

    await client.query("commit");
    return {
      administratorUserId: input.administratorUserId,
      grantVersion: grant.version,
      appealPolicyVersion: appeal.version,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const flagIndex = process.argv.indexOf("--administrator-user-id");
  const administratorUserId = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (!administratorUserId) {
    throw new Error(
      "Usage: mise run ops-gallery-bootstrap -- --administrator-user-id <user-id>",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await bootstrapLocalGallery({
      pool,
      administratorUserId,
      nodeEnv: process.env.NODE_ENV,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
