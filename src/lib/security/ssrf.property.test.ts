// Batch 2 (property-based): the SSRF blocklist must hold for *every* address
// in a private range, not just the handful of examples in ssrf.test.ts.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isBlockedIp, privateTargetsAllowed, resolveSafeUrl } from "./ssrf";

const octet = fc.integer({ min: 0, max: 255 });

const privateV4 = fc.oneof(
  fc.record({ a: fc.constant(10), b: octet, c: octet, d: octet }),
  fc.record({ a: fc.constant(127), b: octet, c: octet, d: octet }),
  fc.record({ a: fc.constant(192), b: fc.constant(168), c: octet, d: octet }),
  fc.record({ a: fc.constant(172), b: fc.integer({ min: 16, max: 31 }), c: octet, d: octet }),
  fc.record({ a: fc.constant(169), b: fc.constant(254), c: octet, d: octet }),
  fc.record({ a: fc.constant(100), b: fc.integer({ min: 64, max: 127 }), c: octet, d: octet })
).map(({ a, b, c, d }) => `${a}.${b}.${c}.${d}`);

const publicV4 = fc
  .record({
    a: fc.integer({ min: 1, max: 223 }),
    b: octet,
    c: octet,
    d: octet,
  })
  .filter(({ a, b }) => {
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  })
  .map(({ a, b, c, d }) => `${a}.${b}.${c}.${d}`);

describe("isBlockedIp properties", () => {
  it("blocks every address inside a private / loopback / link-local range", () => {
    fc.assert(fc.property(privateV4, (ip) => isBlockedIp(ip) === true));
  });

  it("does not block public IPv4 addresses", () => {
    fc.assert(fc.property(publicV4, (ip) => isBlockedIp(ip) === false));
  });

  it("blocks malformed IPv4 shapes instead of letting them through", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 999 }), { minLength: 1, maxLength: 3 }),
        (parts) => isBlockedIp(parts.join(".")) === true
      )
    );
  });

  it("blocks IPv6 loopback, ULA, link-local, multicast and documentation ranges", () => {
    const v6 = fc.oneof(
      fc.constant("::1"),
      fc.constant("::"),
      fc.constant("fe80::1"),
      fc.tuple(fc.integer({ min: 0, max: 0xffff })).map(([x]) => `fc00::${x.toString(16)}`),
      fc.tuple(fc.integer({ min: 0, max: 0xffff })).map(([x]) => `fd12::${x.toString(16)}`),
      fc.tuple(fc.integer({ min: 0, max: 0xffff })).map(([x]) => `ff02::${x.toString(16)}`),
      fc.tuple(fc.integer({ min: 0, max: 0xffff })).map(([x]) => `2001:db8::${x.toString(16)}`)
    );
    fc.assert(fc.property(v6, (ip) => isBlockedIp(ip) === true));
  });

  it("treats IPv4-mapped IPv6 like the embedded IPv4 address", () => {
    fc.assert(
      fc.property(privateV4, (ip) => isBlockedIp(`::ffff:${ip}`) === true)
    );
  });
});

describe("resolveSafeUrl properties", () => {
  it("rejects every non-http(s) scheme", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("ftp", "file", "gopher", "javascript", "data", "ws"),
        fc.webUrl(),
        async (scheme, url) => {
          const raw = url.replace(/^https?/, scheme);
          await expect(resolveSafeUrl(raw)).rejects.toThrow();
          return true;
        }
      )
    );
  });

  it("rejects private targets unless the deployment opts in", async () => {
    const saved = process.env.SSRF_ALLOW_PRIVATE_HOSTS;
    delete process.env.SSRF_ALLOW_PRIVATE_HOSTS;
    expect(privateTargetsAllowed()).toBe(false);

    await fc.assert(
      fc.asyncProperty(privateV4, async (ip) => {
        await expect(resolveSafeUrl(`http://${ip}:8080/`)).rejects.toThrow(/内网|回环|private|blocked|SSRF/i);
        return true;
      })
    );

    if (saved !== undefined) process.env.SSRF_ALLOW_PRIVATE_HOSTS = saved;
  });
});
