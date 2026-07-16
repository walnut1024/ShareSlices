import type { ApiEnv } from "../../env.js";

export type GalleryCapabilityReadiness = Readonly<{
  currentGrant: boolean;
  challengeVerifier: boolean;
  administratorAuthority: boolean;
  reporting: boolean;
  notification: boolean;
  appeal: boolean;
  governance: boolean;
  isolatedContent: boolean;
}>;

export type GalleryConfiguration = Readonly<{
  enabled: boolean;
  webOrigin: URL;
  apiOrigin: URL;
  contentOrigin: URL | null;
  contentRegistrableSite: string | null;
  managementCookieDomain: string | null;
  networkPolicy: "deny_external";
  grantRevision: string | null;
  appealPolicyRevision: string | null;
  readiness: GalleryCapabilityReadiness;
}>;

export function galleryConfigurationFromEnv(env: ApiEnv): GalleryConfiguration {
  return {
    enabled: env.GALLERY_ENABLED,
    webOrigin: new URL(env.WEB_ORIGIN),
    apiOrigin: new URL(env.API_ORIGIN),
    contentOrigin: env.GALLERY_CONTENT_ORIGIN ? new URL(env.GALLERY_CONTENT_ORIGIN) : null,
    contentRegistrableSite: env.GALLERY_CONTENT_REGISTRABLE_SITE ?? null,
    managementCookieDomain: env.GALLERY_MANAGEMENT_COOKIE_DOMAIN ?? null,
    networkPolicy: env.GALLERY_NETWORK_POLICY,
    grantRevision: env.GALLERY_GRANT_REVISION ?? null,
    appealPolicyRevision: env.GALLERY_APPEAL_POLICY_REVISION ?? null,
    readiness: {
      currentGrant: Boolean(env.GALLERY_GRANT_REVISION),
      challengeVerifier: env.GALLERY_CHALLENGE_VERIFIER_READY && Boolean(env.GALLERY_TURNSTILE_SECRET),
      administratorAuthority: env.GALLERY_ADMINISTRATOR_AUTHORITY_READY,
      reporting: env.GALLERY_REPORTING_READY,
      notification: env.GALLERY_NOTIFICATION_READY,
      appeal: env.GALLERY_APPEAL_READY,
      governance: env.GALLERY_GOVERNANCE_READY,
      isolatedContent: env.GALLERY_ISOLATED_CONTENT_READY
    }
  };
}
