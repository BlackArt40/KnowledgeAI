// ---------------------------------------------------------------------------
// Client IP for rate limiting.
//
// X-Forwarded-For is a list that the *client* can seed and each proxy appends
// to. Taking the leftmost entry (the old behaviour) lets an attacker rotate
// fake IPs and bypass every anonymous/user limit. We instead trust the hop
// appended by the nearest proxy: the rightmost entry. Multi-proxy deployments
// (CDN + nginx) set TRUSTED_PROXY_HOPS to the number of proxies in front.
// ---------------------------------------------------------------------------

const DEFAULT_TRUSTED_HOPS = 1;

/** Number of trusted proxy hops in front of the app (>= 1). */
export function trustedProxyHops(): number {
  const parsed = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_TRUSTED_HOPS;
}

export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) {
      const index = Math.max(0, parts.length - trustedProxyHops());
      return parts[index] || "unknown";
    }
  }
  // Set by our nginx (`proxy_set_header X-Real-IP $remote_addr`); only used
  // when XFF is absent (direct/legacy deployments).
  return headers.get("x-real-ip")?.trim() || "unknown";
}
