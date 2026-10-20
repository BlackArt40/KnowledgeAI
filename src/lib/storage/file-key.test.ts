import { describe, expect, it } from "vitest";
import { buildOwnedFileKey, isFileKeyOwnedBy } from "./file-key";

describe("file-key ownership", () => {
  it("embeds the owner id as a namespace", () => {
    const key = buildOwnedFileKey("usr_owner", "0f8fad5b-d9cb-469f-a165-70867728950e", ".PDF");
    expect(key).toBe("usr_owner__0f8fad5b-d9cb-469f-a165-70867728950e.pdf");
    expect(isFileKeyOwnedBy(key, "usr_owner")).toBe(true);
    expect(isFileKeyOwnedBy(key, "usr_viewer")).toBe(false);
  });

  it("does not confuse similar owner id prefixes", () => {
    const key = buildOwnedFileKey("usr_1", "file-1", ".txt");
    expect(isFileKeyOwnedBy(key, "usr_10")).toBe(false);
    expect(isFileKeyOwnedBy(key, "usr_1")).toBe(true);
  });

  it("rejects legacy flat keys and unsafe inputs", () => {
    expect(isFileKeyOwnedBy("0f8fad5b-d9cb-469f-a165-70867728950e.pdf", "usr_owner")).toBe(false);
    expect(() => buildOwnedFileKey("../evil", "file", ".txt")).toThrow("非法文件所有者");
    expect(() => buildOwnedFileKey("usr_ok", "../file", ".txt")).toThrow("非法文件标识");
  });

  it("drops an unsafe extension instead of injecting path characters", () => {
    const key = buildOwnedFileKey("usr_owner", "file-1", "/../evil");
    expect(key).toBe("usr_owner__file-1");
  });
});
