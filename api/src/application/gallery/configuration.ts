import type { ApiEnv } from "../../env.js";

type GalleryEnvironment = Pick<
  ApiEnv,
  | "WEB_ORIGIN"
  | "API_ORIGIN"
  | "GALLERY_ENABLED"
  | "GALLERY_CONTENT_ORIGIN"
  | "GALLERY_CONTENT_REGISTRABLE_SITE"
  | "GALLERY_MANAGEMENT_COOKIE_DOMAIN"
  | "GALLERY_NETWORK_POLICY"
  | "GALLERY_GRANT_REVISION"
  | "GALLERY_APPEAL_POLICY_REVISION"
  | "GALLERY_CHALLENGE_VERIFIER_READY"
  | "GALLERY_TURNSTILE_SECRET"
  | "GALLERY_ADMINISTRATOR_AUTHORITY_READY"
  | "GALLERY_REPORTING_READY"
  | "GALLERY_NOTIFICATION_READY"
  | "GALLERY_APPEAL_READY"
  | "GALLERY_GOVERNANCE_READY"
  | "GALLERY_ISOLATED_CONTENT_READY"
>;

type GalleryContentEnvironment = Omit<GalleryEnvironment, "GALLERY_TURNSTILE_SECRET">;

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

function configurationFromEnvironment(
  env: GalleryContentEnvironment,
  challengeVerifier: boolean,
): GalleryConfiguration {
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
      challengeVerifier,
      administratorAuthority: env.GALLERY_ADMINISTRATOR_AUTHORITY_READY,
      reporting: env.GALLERY_REPORTING_READY,
      notification: env.GALLERY_NOTIFICATION_READY,
      appeal: env.GALLERY_APPEAL_READY,
      governance: env.GALLERY_GOVERNANCE_READY,
      isolatedContent: env.GALLERY_ISOLATED_CONTENT_READY
    }
  };
}

export function galleryConfigurationFromEnv(env: GalleryEnvironment): GalleryConfiguration {
  return configurationFromEnvironment(
    env,
    env.GALLERY_CHALLENGE_VERIFIER_READY && Boolean(env.GALLERY_TURNSTILE_SECRET),
  );
}

export function galleryContentConfigurationFromEnv(
  env: GalleryContentEnvironment,
): GalleryConfiguration {
  return configurationFromEnvironment(env, env.GALLERY_CHALLENGE_VERIFIER_READY);
}
