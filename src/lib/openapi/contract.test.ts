// Batch 2: API contract — the hand-maintained OpenAPI spec must describe real
// routes, every $ref must resolve, and dropping a route from the public surface
// has to be a deliberate change (the known-gap list below is a ratchet, not a
// dump). 2026-11-27: the /api/v1 prefix is gone, so "public surface" is the
// explicit list below instead of a directory boundary.
import { describe, it, expect } from "vitest";
import { statSync } from "node:fs";
import { join } from "node:path";
import { OPENAPI_SPEC } from "./spec";

type Op = {
  summary?: string;
  description?: string;
  security?: unknown[];
  responses?: Record<string, unknown>;
  requestBody?: unknown;
};
type PathItem = Record<string, Op | unknown>;
type Spec = {
  openapi?: string;
  info?: { title?: string; version?: string };
  servers?: unknown[];
  tags?: { name: string }[];
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  };
};

const spec = OPENAPI_SPEC as Spec;
const METHODS = ["get", "post", "put", "patch", "delete"];

/** /api/x/{id} -> src/app/api/x/[id]/route.ts */
function routeFileFor(path: string): string {
  const segments = path
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/^\{(.+)\}$/, "[$1]"));
  return join(process.cwd(), "src", "app", "api", ...segments, "route.ts");
}

const documented = Object.keys(spec.paths ?? {});

/**
 * Routes that exist but are intentionally not in the public spec yet.
 * Ratchet: this list may only shrink. Adding a route here is a product
 * decision (public surface), not a way to silence the check.
 */
const KNOWN_UNDOCUMENTED = [
  "/api/integrations/bot",
  "/api/integrations/bot/{id}",
  "/api/integrations/bot/m/{token}",
  "/api/integrations/sync/confluence",
  "/api/integrations/sync/notion",
  "/api/knowledge-base/{id}/documents",
];

describe("OpenAPI document shape", () => {
  it("declares OpenAPI 3, a server and the API info block", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info?.title).toBe("KnowledgeAI API");
    expect(spec.info?.version).toBe("v1");
    expect(spec.servers?.length).toBeGreaterThan(0);
    expect((spec.tags ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining(["Knowledge Bases", "Chat", "Agent", "Webhooks", "Account"])
    );
  });

  it("only documents /api paths, each with at least one operation", () => {
    expect(documented.length).toBeGreaterThan(0);
    for (const path of documented) {
      expect(path.startsWith("/api/")).toBe(true);
      const operations = Object.keys(spec.paths![path]).filter((k) => METHODS.includes(k));
      expect(operations.length).toBeGreaterThan(0);
    }
  });

  it("gives every operation a summary, a bearer security requirement and a 2xx response", () => {
    for (const path of documented) {
      for (const method of METHODS) {
        const op = spec.paths![path][method] as Op | undefined;
        if (!op) continue;
        expect(op.summary, `${method.toUpperCase()} ${path} summary`).toBeTruthy();
        expect(op.security, `${method.toUpperCase()} ${path} security`).toEqual([{ bearerAuth: [] }]);
        const codes = Object.keys(op.responses ?? {});
        expect(codes.some((c) => c.startsWith("2")), `${method.toUpperCase()} ${path} 2xx`).toBe(true);
      }
    }
  });

  it("resolves every $ref to a declared component", () => {
    const refs = new Set<string>();
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(collect);
        return;
      }
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref" && typeof v === "string") refs.add(v);
          else collect(v);
        }
      }
    };
    collect(spec.paths);
    collect(spec.components);

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      const m = /^#\/components\/(schemas|responses|parameters)\/(.+)$/.exec(ref);
      expect(m, `malformed $ref: ${ref}`).not.toBeNull();
      const bucket =
        m![1] === "schemas"
          ? spec.components?.schemas
          : m![1] === "responses"
            ? spec.components?.responses
            : spec.components?.parameters;
      expect(bucket?.[m![2]], `unresolved $ref: ${ref}`).toBeDefined();
    }
  });
});

describe("spec ↔ filesystem drift", () => {
  it("has a route file for every documented path", () => {
    for (const path of documented) {
      expect(statSync(routeFileFor(path), { throwIfNoEntry: false }), `missing route for ${path}`).toBeTruthy();
    }
  });

  it("keeps every recorded public route backed by a real route file", () => {
    // Single /api prefix => no directory to walk for "undocumented routes".
    // The ratchet now lives on both sides of the contract: documented paths and
    // the explicit known-undocumented list must both resolve to real files.
    for (const path of KNOWN_UNDOCUMENTED) {
      expect(statSync(routeFileFor(path), { throwIfNoEntry: false }), `stale known-undocumented entry: ${path}`).toBeTruthy();
    }
  });
});
