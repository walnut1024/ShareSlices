import type { TrustedIngressResolver } from "./trusted-ingress.js";

function cloudflareClientIp(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 64 || /[,\s\0-\x1f\x7f]/.test(candidate)) {
    return null;
  }
  return candidate;
}

export const cloudflareTrustedIngressResolver: TrustedIngressResolver = (context) => {
  const clientIp = cloudflareClientIp(context.req.header("cf-connecting-ip"));
  return clientIp
    ? { clientIp, source: "cloudflare" }
    : { clientIp: "unknown", source: "unknown" };
};
