import type { Context, MiddlewareHandler } from "hono";

export type TrustedIngressMetadata = Readonly<{
  clientIp: string;
  source: "direct" | "trusted_proxy" | "cloudflare" | "unknown";
}>;

export type TrustedIngressResolver = (
  context: Context,
) => TrustedIngressMetadata | Promise<TrustedIngressMetadata>;

const requestMetadata = new WeakMap<Request, TrustedIngressMetadata>();
const unknownMetadata: TrustedIngressMetadata = Object.freeze({
  clientIp: "unknown",
  source: "unknown",
});

export function trustedIngressMiddleware(
  resolve: TrustedIngressResolver,
): MiddlewareHandler {
  return async (context, next) => {
    requestMetadata.set(context.req.raw, Object.freeze(await resolve(context)));
    await next();
  };
}

export function trustedIngressMetadata(context: Context): TrustedIngressMetadata {
  return requestMetadata.get(context.req.raw) ?? unknownMetadata;
}

export function trustedAuthenticationHeaders(context: Context): Headers {
  const headers = new Headers(context.req.raw.headers);
  headers.delete("cf-connecting-ip");
  headers.delete("forwarded");
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.set("x-forwarded-for", trustedIngressMetadata(context).clientIp);
  return headers;
}
