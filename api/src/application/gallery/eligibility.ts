import { getDomain } from "tldts";
import type { Pool } from "pg";
import type { GalleryCapabilityReadiness, GalleryConfiguration } from "./configuration.js";

export type GalleryIneligibilityReason =
  | "gallery_disabled"
  | "content_origin_missing"
  | "same_origin"
  | "same_host_different_port"
  | "non_dns_topology_unproven"
  | "declared_site_mismatch"
  | "shared_registrable_site"
  | "management_cookie_spans_content"
  | "network_policy_unavailable"
  | "current_grant_unavailable"
  | "challenge_verifier_unavailable"
  | "administrator_authority_unavailable"
  | "reporting_unavailable"
  | "notification_unavailable"
  | "appeal_unavailable"
  | "governance_unavailable"
  | "isolated_content_unavailable";

export type GalleryEligibility = Readonly<{
  eligible: boolean;
  reasons: readonly GalleryIneligibilityReason[];
}>;

const capabilityReasons: Readonly<Record<keyof GalleryCapabilityReadiness, GalleryIneligibilityReason>> = {
  currentGrant: "current_grant_unavailable",
  challengeVerifier: "challenge_verifier_unavailable",
  administratorAuthority: "administrator_authority_unavailable",
  reporting: "reporting_unavailable",
  notification: "notification_unavailable",
  appeal: "appeal_unavailable",
  governance: "governance_unavailable",
  isolatedContent: "isolated_content_unavailable"
};

const isIpOrLocal = (hostname: string): boolean =>
  hostname === "localhost" || hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);

const cookieSpans = (cookieDomain: string, hostname: string): boolean => {
  const normalized = cookieDomain.toLowerCase().replace(/^\./, "");
  const host = hostname.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
};

export function evaluateGalleryEligibility(
  configuration: GalleryConfiguration,
  liveReadiness: GalleryCapabilityReadiness = configuration.readiness
): GalleryEligibility {
  const reasons: GalleryIneligibilityReason[] = [];
  if (!configuration.enabled) reasons.push("gallery_disabled");
  const content = configuration.contentOrigin;
  if (!content) reasons.push("content_origin_missing");
  if (content) {
    if (content.origin === configuration.webOrigin.origin || content.origin === configuration.apiOrigin.origin) reasons.push("same_origin");
    if ((content.hostname === configuration.webOrigin.hostname && content.port !== configuration.webOrigin.port)
      || (content.hostname === configuration.apiOrigin.hostname && content.port !== configuration.apiOrigin.port)) reasons.push("same_host_different_port");
    const hosts = [content.hostname, configuration.webOrigin.hostname, configuration.apiOrigin.hostname];
    if (hosts.some(isIpOrLocal)) reasons.push("non_dns_topology_unproven");
    else {
      const [contentSite, webSite, apiSite] = hosts.map((hostname) => getDomain(hostname, {allowPrivateDomains: true}));
      if (!contentSite || contentSite !== configuration.contentRegistrableSite) reasons.push("declared_site_mismatch");
      if (contentSite === webSite || contentSite === apiSite) reasons.push("shared_registrable_site");
    }
    if (configuration.managementCookieDomain && cookieSpans(configuration.managementCookieDomain, content.hostname)) reasons.push("management_cookie_spans_content");
  }
  if (configuration.networkPolicy !== "deny_external") reasons.push("network_policy_unavailable");
  for (const [capability, reason] of Object.entries(capabilityReasons) as [keyof GalleryCapabilityReadiness, GalleryIneligibilityReason][]) {
    if (!liveReadiness[capability]) reasons.push(reason);
  }
  return {eligible: reasons.length === 0, reasons: [...new Set(reasons)]};
}

export class GalleryRuntimeGate {
  constructor(
    private readonly configuration: GalleryConfiguration,
    private readonly readiness: () => GalleryCapabilityReadiness
  ) {}

  current(): GalleryEligibility {
    return evaluateGalleryEligibility(this.configuration, this.readiness());
  }

  requireEligible(): void {
    const result = this.current();
    if (!result.eligible) throw new GalleryUnavailableError(result.reasons);
  }
}

const runtimeStatusMaxAgeMilliseconds = 60_000;

/**
 * Reads the reconciler's last live capability observation. Static topology is
 * still evaluated locally, so a configuration change cannot be masked by a
 * previously eligible database row.
 */
export async function readGalleryRuntimeEligibility(
  pool: Pick<Pool, "query">,
  configuration: GalleryConfiguration,
  now = new Date(),
): Promise<GalleryEligibility> {
  const { rows } = await pool.query(
    "select eligible,reasons,observed_at from gallery_runtime_status where singleton",
  );
  const row = rows[0] as
    | { eligible: boolean; reasons: GalleryIneligibilityReason[]; observed_at: Date }
    | undefined;
  const fresh =
    row &&
    now.getTime() - new Date(row.observed_at).getTime() <=
      runtimeStatusMaxAgeMilliseconds;
  if (!fresh)
    return {
      eligible: false,
      reasons: ["governance_unavailable", "isolated_content_unavailable"],
    };
  const staticResult = evaluateGalleryEligibility(
    configuration,
    Object.fromEntries(
      Object.keys(capabilityReasons).map((capability) => [capability, true]),
    ) as GalleryCapabilityReadiness,
  );
  const reasons = [...new Set([...staticResult.reasons, ...row.reasons])];
  return { eligible: row.eligible && reasons.length === 0, reasons };
}

export class PostgresGalleryRuntimeGate {
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly configuration: GalleryConfiguration,
  ) {}

  current(): Promise<GalleryEligibility> {
    return readGalleryRuntimeEligibility(this.pool, this.configuration);
  }

  async requireEligible(): Promise<void> {
    const result = await this.current();
    if (!result.eligible) throw new GalleryUnavailableError(result.reasons);
  }
}

export class GalleryUnavailableError extends Error {
  constructor(readonly reasons: readonly GalleryIneligibilityReason[]) {
    super("gallery_unavailable");
  }
}
