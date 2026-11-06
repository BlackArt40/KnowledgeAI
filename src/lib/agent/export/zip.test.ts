// Unit tests for the dependency-free ZIP writer. The archive is the transport
// for PPTX export, so structural correctness matters more than compression
// ratio: PKZIP readers locate entries through the end-of-central-directory
// record and check the CRC32 stored in both the local and central headers.
// The tests therefore parse the produced bytes back with an independent
// reader built on zlib.inflateRawSync (no mocks) and verify CRC32 against
// published check vectors.
import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { zipFiles, type ZipEntry } from "./zip";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

interface ParsedEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
  data: Buffer;
}

interface ParsedZip {
  buf: Buffer;
  entries: ParsedEntry[];
  centralOffset: number;
  centralSize: number;
  eocdOffset: number;
  totalEntries: number;
}

/** Minimal PKZIP reader: walks the EOCD -> central directory -> local headers. */
function readZip(bytes: Uint8Array): ParsedZip {
  const buf = Buffer.from(bytes);
  const eocdOffset = buf.length - 22;
  expect(buf.readUInt32LE(eocdOffset)).toBe(SIG_EOCD);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralSize = buf.readUInt32LE(eocdOffset + 12);
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);
  expect(buf.readUInt16LE(eocdOffset + 20)).toBe(0); // no archive comment

  const entries: ParsedEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    expect(buf.readUInt32LE(p)).toBe(SIG_CENTRAL);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf-8", p + 46, p + 46 + nameLen);

    expect(buf.readUInt32LE(localOffset)).toBe(SIG_LOCAL);
    expect(buf.readUInt32LE(localOffset + 14)).toBe(crc); // local header CRC matches
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    expect(localNameLen).toBe(nameLen);
    expect(buf.toString("utf-8", localOffset + 30, localOffset + 30 + localNameLen)).toBe(name);

    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries.push({
      name,
      method,
      flags,
      crc,
      compSize,
      uncompSize,
      localOffset,
      data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, entries, centralOffset, centralSize, eocdOffset, totalEntries };
}

function entry(name: string, text: string): ZipEntry {
  return { name, data: new Uint8Array(Buffer.from(text, "utf-8")) };
}

describe("zipFiles - round trip", () => {
  it("stores entries readable by a standard PKZIP reader", () => {
    const zip = readZip(zipFiles([entry("a.txt", "hello"), entry("dir/b.txt", "世界")]));
    expect(zip.entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.txt"]);
    expect(zip.entries[0].data.toString("utf-8")).toBe("hello");
    expect(zip.entries[1].data.toString("utf-8")).toBe("世界");
    expect(zip.entries[1].uncompSize).toBe(Buffer.byteLength("世界", "utf-8"));
  });

  it("uses the deflate method with no encryption flag", () => {
    const [e] = readZip(zipFiles([entry("a.txt", "x")])).entries;
    expect(e.method).toBe(8);
    expect(e.flags).toBe(0);
  });

  it("round-trips binary (non UTF-8) payloads byte for byte", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 0x50, 0x4b]);
    const [e] = readZip(zipFiles([{ name: "bin", data: bytes }])).entries;
    expect([...e.data]).toEqual([...bytes]);
  });

  it("keeps a UTF-8 archive name intact", () => {
    const zip = readZip(zipFiles([entry("报告/第一章.md", "内容")]));
    expect(zip.entries[0].name).toBe("报告/第一章.md");
  });
});

describe("zipFiles - CRC32", () => {
  // Published CRC-32 (IEEE 802.3) check vectors.
  it("matches the standard check value for '123456789'", () => {
    const [e] = readZip(zipFiles([entry("a", "123456789")])).entries;
    expect(e.crc).toBe(0xcbf43926);
  });

  it("matches the standard check value for the pangram", () => {
    const [e] = readZip(zipFiles([entry("a", "The quick brown fox jumps over the lazy dog")])).entries;
    expect(e.crc).toBe(0x414fa339);
  });

  it("uses 0 for empty content", () => {
    const [e] = readZip(zipFiles([{ name: "empty", data: new Uint8Array(0) }])).entries;
    expect(e.crc).toBe(0);
    expect(e.uncompSize).toBe(0);
    expect(e.data).toHaveLength(0);
  });
});

describe("zipFiles - container layout", () => {
  it("emits only the EOCD record for an empty entry list", () => {
    const zip = readZip(zipFiles([]));
    expect(zip.buf).toHaveLength(22);
    expect(zip.totalEntries).toBe(0);
    expect(zip.centralOffset).toBe(0);
    expect(zip.centralSize).toBe(0);
    expect(zip.buf.readUInt32LE(0)).toBe(SIG_EOCD);
  });

  it("records matching entry counts on both EOCD fields", () => {
    const { buf, eocdOffset, totalEntries } = readZip(zipFiles([entry("a", "1"), entry("b", "2")]));
    expect(totalEntries).toBe(2);
    expect(buf.readUInt16LE(eocdOffset + 8)).toBe(2);
  });

  it("places the central directory immediately after the last local entry", () => {
    const zip = readZip(zipFiles([entry("a.txt", "aaa"), entry("b.txt", "bbb")]));
    const [first, second] = zip.entries;
    expect(first.localOffset).toBe(0);
    expect(second.localOffset).toBe(30 + "a.txt".length + first.compSize);
    // local data + central directory + EOCD must tile the whole buffer
    const localEnd = 30 + "b.txt".length + second.compSize + second.localOffset;
    expect(localEnd).toBe(zip.centralOffset);
    expect(zip.centralOffset + zip.centralSize).toBe(zip.eocdOffset);
    expect(zip.buf).toHaveLength(zip.eocdOffset + 22);
  });

  it("actually compresses repetitive content", () => {
    const [e] = readZip(zipFiles([{ name: "big", data: new Uint8Array(Buffer.from("A".repeat(50_000))) }])).entries;
    expect(e.compSize).toBeLessThan(e.uncompSize);
    expect(e.uncompSize).toBe(50_000);
    expect(e.data.toString("utf-8")).toBe("A".repeat(50_000));
  });
});
