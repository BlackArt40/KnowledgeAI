// 共享与分发：知识库级公开链接（过期 / 密码 / 次数 / 撤销 + private 文档隐藏）。
import { beforeEach, describe, expect, it } from "vitest";
import { addDocument, createKb, setDocumentAccess } from "./store";
import {
  checkKbShare,
  createKbShare,
  getKbShare,
  getKbShareByKb,
  revokeKbShare,
  revokeKbShareByKb,
  sanitizeKbShare,
} from "./kb-share";

const OWNER = "usr_owner";

function freshKb(name = "share-kb") {
  const kb = createKb({ name, desc: "desc" }, OWNER);
  return kb;
}

function addDoc(kbId: string, name: string, access?: "private") {
  const doc = addDocument({
    kbId,
    name,
    size: 10,
    content: `# ${name}\n正文内容`,
    skipEnqueue: true,
  });
  if (access) setDocumentAccess(doc.id, access);
  return doc;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_KB_SHARE_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_KB_STORE__;
});

describe("kb share links", () => {
  it("creates one active link per KB (replacing the previous token)", () => {
    const kb = freshKb();
    const first = createKbShare({ kbId: kb.id, createdBy: OWNER });
    expect(first.token.startsWith("ks_")).toBe(true);
    expect(getKbShare(first.token)?.kbId).toBe(kb.id);

    const second = createKbShare({ kbId: kb.id, createdBy: OWNER });
    expect(second.token).not.toBe(first.token);
    expect(getKbShare(first.token)).toBeUndefined();
    expect(getKbShareByKb(kb.id)?.token).toBe(second.token);
  });

  it("returns the KB and only non-private documents", () => {
    const kb = freshKb("公开库");
    const pub = addDoc(kb.id, "public.md");
    addDoc(kb.id, "secret.md", "private");
    const share = createKbShare({ kbId: kb.id, createdBy: OWNER });

    const res = checkKbShare(share.token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.kb.name).toBe("公开库");
    expect(res.docs.map((d) => d.id)).toEqual([pub.id]);
    expect(res.share.views).toBe(1);
  });

  it("does not count a view twice when previewing a document", () => {
    const kb = freshKb();
    const share = createKbShare({ kbId: kb.id, createdBy: OWNER });
    const first = checkKbShare(share.token);
    expect(first.ok && first.share.views).toBe(1);
    const preview = checkKbShare(share.token, undefined, { countView: false });
    expect(preview.ok && preview.share.views).toBe(1);
  });

  it("enforces expiry", () => {
    const kb = freshKb();
    const share = createKbShare({
      kbId: kb.id,
      createdBy: OWNER,
      expiresAt: Date.now() - 1_000,
    });
    const res = checkKbShare(share.token);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(410);
    expect(res.code).toBe("expired");
  });

  it("enforces the optional password", () => {
    const kb = freshKb();
    const share = createKbShare({ kbId: kb.id, createdBy: OWNER, password: "open-sesame" });

    const missing = checkKbShare(share.token);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect([missing.status, missing.code]).toEqual([401, "needPassword"]);

    const wrong = checkKbShare(share.token, "nope");
    expect(wrong.ok).toBe(false);

    const ok = checkKbShare(share.token, "open-sesame");
    expect(ok.ok).toBe(true);
    // failed attempts must not consume views
    expect(ok.ok && ok.share.views).toBe(1);
  });

  it("enforces the view limit", () => {
    const kb = freshKb();
    const share = createKbShare({ kbId: kb.id, createdBy: OWNER, maxViews: 1 });
    expect(checkKbShare(share.token).ok).toBe(true);
    const second = checkKbShare(share.token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect([second.status, second.code]).toEqual([403, "exhausted"]);
  });

  it("revokes by token and by KB", () => {
    const kb = freshKb();
    const a = createKbShare({ kbId: kb.id, createdBy: OWNER });
    expect(revokeKbShare(a.token)).toBe(true);
    expect(checkKbShare(a.token).ok).toBe(false);

    createKbShare({ kbId: kb.id, createdBy: OWNER });
    expect(revokeKbShareByKb(kb.id)).toBe(true);
    expect(getKbShareByKb(kb.id)).toBeUndefined();
    expect(revokeKbShare("missing")).toBe(false);
  });

  it("sanitizes the password hash from the public config", () => {
    const kb = freshKb();
    const share = createKbShare({ kbId: kb.id, createdBy: OWNER, password: "x" });
    const safe = sanitizeKbShare(share);
    expect("passwordHash" in safe).toBe(false);
    expect(safe.token).toBe(share.token);
  });

  it("reports notFound for an unknown token", () => {
    const res = checkKbShare("ks_missing");
    expect(res.ok).toBe(false);
    if (!res.ok) expect([res.status, res.code]).toEqual([404, "notFound"]);
  });
});
