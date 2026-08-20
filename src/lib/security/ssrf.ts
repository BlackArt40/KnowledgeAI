// ---------------------------------------------------------------------------
// SSRF protection (P0-4 / P1-4) - outbound URL safety for user-controlled
// fetch targets (web-link uploads, webhook delivery).
//
// Attack: a user submits `http://169.254.169.254/...` (cloud metadata),
// `http://localhost/...` or an internal host; the server fetches it and the
// content gets indexed / delivered, exfiltrating internal data (or the
// request itself has a side effect, e.g. hitting an admin API).
//
// Defense:
//   1. scheme whitelist (http/https only)
//   2. IP literals (v4 + v6): block private / loopback / link-local / ULA /
//      CGNAT / multicast / reserved ranges
//   3. hostnames: resolve ALL A/AAAA records and reject if ANY of them is
//      private (DNS-rebinding safe at resolution time)
//   4. callers must follow redirects manually (redirect: "manual") and
//      re-validate every hop with resolveSafeUrl - a redirect to an internal
//      address is just as dangerous as the original URL.
// ---------------------------------------------------------------------------

import dns from "node:dns/promises";

/** Maximum redirect hops a caller will follow (each hop is re-validated). */
export const MAX_SSRF_REDIRECTS = 5;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true; // malformed → block
  const [a, b] = parts;
  if (a === 0 || a === 127 || a === 10) return true; // "this network" / loopback / 10/8
  if (a === 169 && b === 254) return true; // link-local 169.254/16 (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("2001:db8")) return true; // documentation range
  if (lower.includes("::ffff:")) {
    const m = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIpv4(m[1]); // IPv4-mapped IPv6
  }
  return false;
}

/** True when `ip` is private / loopback / link-local / reserved (SSRF-blocked). */
export function isBlockedIp(ip: string): boolean {
  const v6 = ip.includes(":");
  const host = v6 ? ip.split("%")[0] : ip; // strip IPv6 zone id (fe80::1%eth0)
  return v6 ? isPrivateIpv6(host) : isPrivateIpv4(host);
}

/**
 * Validate a user-controlled URL and resolve its hostname, rejecting:
 *  - non-http(s) schemes
 *  - private / loopback / link-local / reserved IP literals
 *  - hostnames that resolve (at this moment) to any private address
 *
 * Returns the (unchanged) URL when safe; throws Error otherwise.
 * Callers MUST use redirect:"manual" and re-call this on every Location hop.
 */
export async function resolveSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("URL 格式非法");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("仅允许 http/https URL");
  }
  const host = u.hostname;
  if (!host) throw new Error("URL 缺少主机名");

  // IP literal fast path (IPv6 hostnames arrive bracketed: "[::1]")
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^[\d.]+$/.test(bareHost) || bareHost.includes(":")) {
    if (isBlockedIp(bareHost)) throw new Error("禁止访问内网/回环地址");
    return u;
  }

  // Hostname: resolve every A/AAAA record; any private hit blocks the URL.
  let records: { address: string }[] = [];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("域名解析失败");
  }
  if (records.length === 0) throw new Error("域名无有效解析结果");
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new Error(`目标地址被禁止（内网/回环）: ${r.address}`);
    }
  }
  return u;
}
