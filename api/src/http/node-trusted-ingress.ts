// cspell:ignore conninfo
import { getConnInfo } from "@hono/node-server/conninfo";
import { BlockList, isIP } from "node:net";
import type { TrustedIngressResolver } from "./trusted-ingress.js";

function normalizeIp(value: string | undefined): string | null {
  const candidate = value?.trim().replace(/^\[|\]$/g, "");
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

function trustedProxyList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const value of cidrs) {
    const [network, prefixText] = value.split("/");
    const family = isIP(network ?? "");
    const prefix = Number(prefixText);
    const maximum = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
      throw new Error(`Invalid trusted-proxy CIDR: ${value}`);
    }
    list.addSubnet(network!, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return list;
}

function isTrusted(list: BlockList, address: string): boolean {
  const family = isIP(address);
  return list.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function createNodeTrustedIngressResolver(
  trustedProxyCidrs: readonly string[],
): TrustedIngressResolver {
  const proxies = trustedProxyList(trustedProxyCidrs);
  return (context) => {
    const peer = normalizeIp(getConnInfo(context).remote.address);
    if (!peer) return { clientIp: "unknown", source: "unknown" };
    if (!isTrusted(proxies, peer)) return { clientIp: peer, source: "direct" };

    const forwarded = (context.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => normalizeIp(part))
      .filter((part): part is string => Boolean(part));
    let clientIp = peer;
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      if (!isTrusted(proxies, clientIp)) break;
      clientIp = forwarded[index]!;
    }
    return { clientIp, source: "trusted_proxy" };
  };
}
