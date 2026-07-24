import {canonicalize} from "../automation/canonical.mjs";
import {withPostgresControlClient} from "../automation/control-observation.mjs";
import {CloudflareReleaseVerificationError} from "./release-verification-executor.mjs";

function fail(code, message) {
  throw new CloudflareReleaseVerificationError(code, message);
}

function expectedContainerIdentity(message) {
  const containers = message?.expected?.containers;
  if (!Array.isArray(containers) || containers.length < 2) {
    fail(
      "cloudflare_release_verification_probe_identity_invalid",
      "Release verification Container identity is incomplete.",
    );
  }
  const grouped = {};
  for (const container of containers) {
    const {
      containerClass,
      stableSlot,
      buildIdentity,
      contractRevision,
      imageReference,
    } = container ?? {};
    if (
      !["trusted-processing", "thumbnail"].includes(containerClass) ||
      ![stableSlot, buildIdentity, contractRevision, imageReference]
        .every((value) => typeof value === "string" && value.length > 0)
    ) {
      fail(
        "cloudflare_release_verification_probe_identity_invalid",
        "Release verification Container identity is invalid.",
      );
    }
    const existing = grouped[containerClass];
    if (
      existing &&
      (
        existing.buildIdentity !== buildIdentity ||
        existing.contractRevision !== contractRevision ||
        existing.imageReference !== imageReference ||
        existing.stableSlots.includes(stableSlot)
      )
    ) {
      fail(
        "cloudflare_release_verification_probe_identity_invalid",
        "Release verification Container class identity is inconsistent.",
      );
    }
    grouped[containerClass] ??= {
      releaseId: message.releaseId,
      buildIdentity,
      contractRevision,
      imageReference,
      stableSlots: [],
    };
    grouped[containerClass].stableSlots.push(stableSlot);
  }
  if (!grouped["trusted-processing"] || !grouped.thumbnail) {
    fail(
      "cloudflare_release_verification_probe_identity_invalid",
      "Release verification must cover both Container classes.",
    );
  }
  for (const identity of Object.values(grouped)) {
    identity.stableSlots.sort();
  }
  return canonicalize({containers: grouped});
}

export function createPostgresReleaseVerificationProbeInitializer({
  config,
  resolvers,
  ClientClass,
  withControlClient = withPostgresControlClient,
} = {}) {
  return async ({lease, message}) => {
    if (
      lease?.target !== "cloudflare" ||
      lease.fencingToken !== message?.fence ||
      lease.desiredReleaseId !== message?.releaseId ||
      !Number.isSafeInteger(message?.subFence) ||
      message.subFence <= 0
    ) {
      fail(
        "cloudflare_release_verification_probe_scope_invalid",
        "Release verification probe scope does not match the deployment lease.",
      );
    }
    const expectedIdentity = expectedContainerIdentity(message);
    return withControlClient(
      config,
      resolvers,
      async (client) => {
        await client.query("begin");
        try {
          const inserted = await client.query(
            `insert into cloudflare_release_verification_probe(
               nonce, release_id, fence, sub_fence, expected_identity
             )
             select $6, operation.desired_release_id,
                    operation.fencing_token, $7, $8::jsonb
             from shareslices_deployment_operation operation
             where operation.installation_id = $1
               and operation.operation_id = $2
               and operation.lease_owner = $3
               and operation.fencing_token = $4
               and operation.target = 'cloudflare'
               and operation.desired_release_id = $5
               and operation.state = 'active'
               and operation.lease_expires_at > now()
             on conflict (nonce) do nothing
             returning nonce`,
            [
              lease.installationId,
              lease.operationId,
              lease.owner,
              lease.fencingToken,
              lease.desiredReleaseId,
              message.nonce,
              message.subFence,
              JSON.stringify(expectedIdentity),
            ],
          );
          if (inserted.rowCount !== 1) {
            const replay = await client.query(
              `select nonce
               from cloudflare_release_verification_probe
               where nonce = $1 and release_id = $2 and fence = $3
                 and sub_fence = $4 and state = 'active'
                 and expected_identity = $5::jsonb`,
              [
                message.nonce,
                message.releaseId,
                message.fence,
                message.subFence,
                JSON.stringify(expectedIdentity),
              ],
            );
            if (replay.rowCount !== 1) {
              fail(
                "cloudflare_release_verification_probe_conflict",
                "Release verification probe nonce already has another identity or fence.",
              );
            }
          }
          await client.query("commit");
          return Object.freeze({
            nonce: message.nonce,
            releaseId: message.releaseId,
            fence: message.fence,
            subFence: message.subFence,
            state: "active",
          });
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        }
      },
      ClientClass,
    );
  };
}
