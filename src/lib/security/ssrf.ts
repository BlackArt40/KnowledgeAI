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
//
// Dev/test escape hatch: the webhook acceptance smoke registers a receiver on
// 127.0.0.1. The opt-in is `SSRF_ALLOW_PRIVATE_HOSTS=true` AND NODE_ENV
// explicitly development/test - a production process can never reach a private
// target through it. It is read only inside this module (see
// privateTargetsAllowed); callers have no argument that can disable the check.
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
/**
 * True when the current process may talk to private / loopback targets.
 *
 * Fail-closed: requires the explicit `SSRF_ALLOW_PRIVATE_HOSTS=true` opt-in
 * AND a NODE_ENV that is explicitly a local one. F6 (2026-09-30) hardened this
 * from `NODE_ENV !== "production"` - an unset or misspelled NODE_ENV used to
 * open the hatch on a production box. A process that is not clearly
 * development/test is treated as production now.
 */
export function privateTargetsAllowed(): boolean {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") return false;
  return process.env.SSRF_ALLOW_PRIVATE_HOSTS === "true";
}

export async function resolveSafeUrl(rawUrl: string): Promise<URL> {
  // F6: the relaxation is a deployment policy decided HERE, from the
  // environment only - not something a call site can switch off. The previous
  // `{ allowPrivate: true }` argument sat on user-reachable business paths
  // (webhook create/update/delivery), where one misconfigured NODE_ENV turned
  // it into a real SSRF. Call sites now never see a "disable the check" knob.
  const allowPrivate = privateTargetsAllowed();

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
    if (isBlockedIp(bareHost) && !allowPrivate) throw new Error("禁止访问内网/回环地址");
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
    if (isBlockedIp(r.address) && !allowPrivate) {
      throw new Error(`目标地址被禁止（内网/回环）: ${r.address}`);
    }
  }
  return u;
}

// ── Model baseUrl (F1, 2026-09-30) ─────────────────────────────────────────
//
// A user-supplied LLM `baseUrl` is an outbound request target the server
// fetches (`POST {baseUrl}/chat/completions`, `GET {baseUrl}/models`) on every
// chat turn. It used to bypass `resolveSafeUrl` entirely, so any signed-in
// user could point it at the cloud metadata service or an internal host and
// read the first 200 characters of the response back out of the error message.
//
// Cloud metadata (169.254.0.0/16) is blocked UNCONDITIONALLY - no LLM endpoint
// ever lives there, and it is the single highest-value SSRF target.
//
// Self-hosted deployments legitimately point baseUrl at a private LLM (Ollama
// / vLLM on the LAN or on localhost). Those operators consciously accept the
// risk by setting LLM_ALLOW_PRIVATE_BASE_URL=true; unlike the webhook smoke
// escape hatch this one is NOT disabled in production, because the private
// endpoint IS the production configuration there.

/** True when `ip` is inside the cloud-metadata link-local range. */
export function isCloudMetadataIp(ip: string): boolean {
  const v6 = ip.includes(":");
  const host = v6 ? ip.split("%")[0] : ip;
  if (v6) {
    // IPv4-mapped IPv6 (::ffff:169.254.x.x) and the IPv6 link-local range.
    const m = host.toLowerCase().match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isCloudMetadataIp(m[1]);
    return host.toLowerCase().startsWith("fe80:");
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  return parts[0] === 169 && parts[1] === 254;
}

/** Whether operators opted in to private LLM endpoints
 *  (`LLM_ALLOW_PRIVATE_BASE_URL=true`). */
export function modelBaseUrlPrivateAllowed(): boolean {
  return process.env.LLM_ALLOW_PRIVATE_BASE_URL === "true";
}

function assertModelIpSafe(ip: string, allowPrivate: boolean): void {
  if (isCloudMetadataIp(ip)) {
    throw new Error("禁止访问云元数据地址（169.254.0.0/16）");
  }
  if (!isBlockedIp(ip)) return;
  if (allowPrivate) return;
  // Actionable message: a self-hosted Ollama / vLLM endpoint is a legitimate
  // private target, but enabling it is an operator decision (it lets any
  // signed-in user reach the internal network), hence the env var hint.
  throw new Error(
    `模型地址被禁止（内网/回环）: ${ip}。若为自托管模型端点，需管理员设置 LLM_ALLOW_PRIVATE_BASE_URL=true`
  );
}

/**
 * Authoritative SSRF check for a user-supplied LLM `baseUrl`. Call this on
 * every WRITE path (create / update / test / fetch-list) and reject on throw.
 * Resolves DNS, so it is not suitable for the per-request hot path - use
 * `modelBaseUrlPrecheck` there.
 */
export async function resolveSafeModelBaseUrl(rawUrl: string): Promise<URL> {
  const allowPrivate = modelBaseUrlPrivateAllowed();
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

  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^[\d.]+$/.test(bareHost) || bareHost.includes(":")) {
    assertModelIpSafe(bareHost, allowPrivate);
    return u;
  }

  let records: { address: string }[] = [];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("域名解析失败");
  }
  if (records.length === 0) throw new Error("域名无有效解析结果");
  for (const r of records) assertModelIpSafe(r.address, allowPrivate);
  return u;
}

/**
 * DNS-free pre-check for the per-request hot path. Catches the cheap,
 * high-signal cases (bad scheme, IP literal in a blocked range, metadata
 * address) without a lookup. Rows that predate the write-path validation are
 * caught here; a hostname that only resolves privately is NOT (that is what
 * the write path is for).
 *
 * Returns `{ ok: false, reason }` when the URL must not be used.
 */
export function modelBaseUrlPrecheck(rawUrl: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL 格式非法" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "仅允许 http/https URL" };
  }
  const host = u.hostname;
  if (!host) return { ok: false, reason: "URL 缺少主机名" };
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^[\d.]+$/.test(bareHost) || bareHost.includes(":")) {
    if (isCloudMetadataIp(bareHost)) return { ok: false, reason: "禁止访问云元数据地址" };
    if (isBlockedIp(bareHost) && !modelBaseUrlPrivateAllowed()) {
      return { ok: false, reason: "模型地址被禁止（内网/回环）" };
    }
  }
  return { ok: true };
}

