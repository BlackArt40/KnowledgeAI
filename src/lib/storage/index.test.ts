// Batch 2 (P1): storage abstraction in local mode (S3 path needs a live
// endpoint and is covered by the smoke `infra` group). Focus: the whitelist,
// the deterministic document key, and the path-containment check that keeps a
// crafted key from escaping .uploads.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPresignedUpload,
  deleteDocFile,
  deleteFile,
  docStorageKey,
  isStorageEnabled,
  readFile,
  saveDocFile,
  saveFile,
  validateFile,
} from "./index";

const written: string[] = [];

beforeEach(() => {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_ACCESS_KEY;
  delete process.env.S3_SECRET_KEY;
});

afterAll(async () => {
  for (const key of written) await deleteFile(key).catch(() => {});
});

describe("validateFile", () => {
  it.each([".md", ".PDF", ".docx", ".xlsx", ".srt", ".png", ".csv", ".markdown"])(
    "accepts the whitelisted extension %s",
    (ext) => {
      expect(validateFile(`file${ext}`, 1024)).toEqual({ ok: true });
    }
  );

  it.each([".exe", ".sh", ".zip", "", ".md.exe"])("rejects %s and lists the allowed set", (ext) => {
    const res = validateFile(`file${ext}`, 1024);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("不支持的文件类型");
  });

  it("rejects files above the 50 MB default with a readable message", () => {
    const res = validateFile("big.md", 51 * 1024 * 1024);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("文件过大");
    expect(res.error).toContain("51.0MB");
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateFile("edge.md", 50 * 1024 * 1024)).toEqual({ ok: true });
  });
});

describe("docStorageKey", () => {
  it("derives a deterministic, sanitised key", () => {
    expect(docStorageKey("kb_1", "doc_1", "季度 报告?.pdf")).toBe("kb_1/doc_1-季度_报告_.pdf");
  });

  it("keeps Chinese characters and dots/dashes", () => {
    expect(docStorageKey("kb_1", "doc_1", "报告-v1.2.md")).toBe("kb_1/doc_1-报告-v1.2.md");
  });

  it("replaces every slash so the key cannot nest directories", () => {
    expect(docStorageKey("kb_1", "doc_1", "../../etc/passwd")).toBe("kb_1/doc_1-.._.._etc_passwd");
  });
});

describe("local mode", () => {
  it("reports storage disabled without S3 credentials", () => {
    expect(isStorageEnabled()).toBe(false);
  });

  it("returns null for a presigned upload (caller falls back to multipart)", async () => {
    await expect(createPresignedUpload("a.md")).resolves.toBeNull();
  });

  it("round-trips a file through saveFile/readFile and deletes it", async () => {
    const data = Buffer.from("# hello\n本地存储往返");
    const saved = await saveFile("note.md", data, "usr_storage_test");
    written.push(saved.key);

    expect(saved.size).toBe(data.byteLength);
    expect(saved.url).toBe(`/api/files/${saved.key}`);
    expect(saved.key.startsWith("usr_storage_test__")).toBe(true);

    await expect(readFile(saved.key)).resolves.toEqual(data);
    await deleteFile(saved.key);
    await expect(readFile(saved.key)).rejects.toThrow();
  });

  it("refuses keys that escape the uploads root", async () => {
    await expect(readFile("../package.json")).rejects.toThrow(/非法文件 key/);
    await expect(readFile("/etc/passwd")).rejects.toThrow(/非法文件 key/);
  });

  it("writes document files under .uploads/<kb>/ and deletes them silently", async () => {
    const backend = await saveDocFile("kb_storage", "doc_1", "a.md", Buffer.from("body"));
    expect(backend).toBe("local");

    // Deleting twice must not throw (cleanup paths run on already-gone files).
    await expect(deleteDocFile("kb_storage", "doc_1", "a.md")).resolves.toBeUndefined();
    await expect(deleteDocFile("kb_storage", "doc_1", "a.md")).resolves.toBeUndefined();
  });
});
