// The old verifier required strict adjacency, so any two processes appending
// concurrently produced valid:false. The new verifier checks each entry's HMAC
// and that its prevHash exists in the retained set (GENESIS allowed).

import crypto from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getAuthSecret } from "@/lib/secrets";
import { verifyAuditChain, type AuditEvent } from "./audit";

const g = globalThis as unknown as { __KAI_AUDIT_STORE__?: AuditEvent[] };

function hash(prevHash: string, e: Omit<AuditEvent, "prevHash" | "hash">): string {
  const secret = getAuthSecret("knowledgeai-dev-secret-change-me");
  return crypto
    .createHmac("sha256", secret)
    .update([
      prevHash, e.id, e.actorId ?? "", e.actor, e.action,
      e.target, e.detail, e.ip ?? "", String(e.createdAt),
    ].join("|"))
    .digest("hex");
}

function event(id: string, createdAt: number, prevHash: string): AuditEvent {
  const base = {
    id,
    actorId: "usr_1",
    actor: "tester",
    action: "test",
    target: "",
    detail: "",
    ip: null,
    createdAt,
  };
  return { ...base, prevHash, hash: hash(prevHash, base) };
}

beforeEach(() => {
  g.__KAI_AUDIT_STORE__ = [];
});

describe("verifyAuditChain (multi-process)", () => {
  it("accepts two sibling branches from independent processes", () => {
    // Process A: a1(genesis) <- a2(a1)
    // Process B: b1(genesis) <- b2(b1)
    const a1 = event("a1", 1000, "genesis");
    const a2 = event("a2", 1002, a1.hash);
    const b1 = event("b1", 1001, "genesis");
    const b2 = event("b2", 1003, b1.hash);
    // Newest first, as the store maintains it.
    g.__KAI_AUDIT_STORE__ = [b2, a2, b1, a1];

    expect(verifyAuditChain()).toMatchObject({ valid: true, brokenAt: -1 });
  });

  it("detects a tampered field via its HMAC", () => {
    const a1 = event("a1", 1000, "genesis");
    g.__KAI_AUDIT_STORE__ = [{ ...a1, detail: "tampered" }];

    expect(verifyAuditChain()).toMatchObject({ valid: false, brokenAt: 0 });
  });

  it("detects a deleted middle entry", () => {
    const a1 = event("a1", 1000, "genesis");
    const a2 = event("a2", 1001, a1.hash);
    const a3 = event("a3", 1002, a2.hash);
    // a2 removed; a3 still points at it.
    g.__KAI_AUDIT_STORE__ = [a3, a1];

    expect(verifyAuditChain()).toMatchObject({ valid: false });
  });
});
