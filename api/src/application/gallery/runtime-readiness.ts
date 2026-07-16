import type { Pool } from "pg";
import type {
  GalleryCapabilityReadiness,
  GalleryConfiguration,
} from "./configuration.js";

const contentProbeTimeoutMilliseconds = 3_000;

export async function observeGalleryCapabilityReadiness(
  pool: Pick<Pool, "query">,
  configuration: GalleryConfiguration,
  fetchImplementation: typeof fetch = fetch,
): Promise<GalleryCapabilityReadiness> {
  const { rows } = await pool.query(
    `select
      exists(select 1 from gallery_permission_grant where active and version=$1) current_grant,
      exists(select 1 from gallery_administrator_authority where revoked_at is null and scope='gallery_governance') administrator_authority,
      exists(select 1 from gallery_appeal_policy where active and version=$2) appeal_policy`,
    [configuration.grantRevision, configuration.appealPolicyRevision],
  );
  const state = rows[0] as
    | {
        current_grant: boolean;
        administrator_authority: boolean;
        appeal_policy: boolean;
      }
    | undefined;
  const isolatedContent = await probeIsolatedContent(
    configuration.contentOrigin,
    fetchImplementation,
  );

  return {
    currentGrant:
      configuration.readiness.currentGrant && state?.current_grant === true,
    challengeVerifier: configuration.readiness.challengeVerifier,
    administratorAuthority:
      configuration.readiness.administratorAuthority &&
      state?.administrator_authority === true,
    reporting: configuration.readiness.reporting,
    notification: configuration.readiness.notification,
    appeal:
      configuration.readiness.appeal && state?.appeal_policy === true,
    governance:
      configuration.readiness.governance &&
      state?.administrator_authority === true &&
      state?.appeal_policy === true,
    isolatedContent:
      configuration.readiness.isolatedContent && isolatedContent,
  };
}

async function probeIsolatedContent(
  contentOrigin: URL | null,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  if (!contentOrigin) return false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    contentProbeTimeoutMilliseconds,
  );
  timeout.unref?.();
  try {
    const response = await fetchImplementation(new URL("/ready", contentOrigin), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
