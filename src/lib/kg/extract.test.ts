// P7-3 unit tests: entity extraction (pattern NER) - deterministic demo path.
import { describe, it, expect } from "vitest";
import { extractEntities, extractRelations, aggregateMentions } from "./extract";

describe("extractEntities (demo NER)", () => {
  it("extracts Chinese person names with titles", () => {
    const m = extractEntities("王建国先生出席了会议，李娜博士作了报告，刘洋博士负责记录。");
    const persons = m.filter((x) => x.type === "person").map((x) => x.label);
    expect(persons).toContain("王建国先生");
    expect(persons).toContain("李娜博士");
    expect(persons).toContain("刘洋博士");
  });

  it("extracts Chinese organizations by suffix", () => {
    const m = extractEntities("晨曦科技与蓝海集团签署协议，星辰支付公司参与合作，华东大学提供支持。");
    const orgs = m.filter((x) => x.type === "organization").map((x) => x.label);
    expect(orgs).toContain("晨曦科技");
    expect(orgs).toContain("蓝海集团");
    expect(orgs).toContain("星辰支付公司");
    expect(orgs).toContain("华东大学");
  });

  it("extracts quoted concepts", () => {
    const m = extractEntities("会议上提出了「数据驱动」和“零信任安全”两个概念，并发布了《白皮书》。");
    const concepts = m.filter((x) => x.type === "concept").map((x) => x.label);
    expect(concepts).toContain("数据驱动");
    expect(concepts).toContain("零信任安全");
    expect(concepts).toContain("白皮书");
  });

  it("extracts events with date/ordinal prefixes", () => {
    const m = extractEntities("2025年全球人工智能大会于三月召开，公司参加了首届开发者峰会并宣布产品发布。");
    const events = m.filter((x) => x.type === "event").map((x) => x.label);
    expect(events.some((e) => e.includes("大会"))).toBe(true);
    expect(events.some((e) => e.includes("峰会"))).toBe(true);
  });

  it("extracts English entities", () => {
    const m = extractEntities(
      "Dr. Alice Johnson from CloudBase Inc. attended the AI Summit 2025 and introduced the \"Zero Trust\" concept."
    );
    expect(m.some((x) => x.type === "person" && x.label.includes("Alice Johnson"))).toBe(true);
    expect(m.some((x) => x.type === "organization" && x.label.includes("CloudBase"))).toBe(true);
    expect(m.some((x) => x.type === "concept" && x.label === "Zero Trust")).toBe(true);
  });

  it("keeps occurrences (aggregation happens downstream)", () => {
    const m = extractEntities("晨曦科技与蓝海集团合作，晨曦科技是云服务商，蓝海集团做支付。");
    const orgs = m.filter((x) => x.type === "organization").map((x) => x.label);
    expect(orgs.filter((l) => l === "晨曦科技").length).toBe(2);
    expect(orgs.filter((l) => l === "蓝海集团").length).toBe(2);
  });

  it("ignores tiny/empty inputs", () => {
    expect(extractEntities("")).toEqual([]);
    expect(extractEntities("a")).toEqual([]);
  });
});

describe("extractRelations (sentence co-occurrence)", () => {
  it("pairs entities sharing a sentence", () => {
    const text = "晨曦科技与蓝海集团签署战略合作协议。星辰支付公司独立运营。";
    const mentions = extractEntities(text);
    const rels = extractRelations(text, mentions);
    expect(rels.some((r) => r.source === "晨曦科技" && r.target === "蓝海集团")).toBe(true);
    // 星辰支付公司 appears in a different sentence -> no relation to the pair
    expect(rels.some((r) => r.source === "晨曦科技" && r.target === "星辰支付公司")).toBe(false);
  });

  it("no relations when fewer than two entities", () => {
    expect(extractRelations("只有一句话。", [{ label: "晨曦科技", type: "organization" }])).toEqual([]);
  });
});

describe("aggregateMentions", () => {
  it("counts per type+label", () => {
    const agg = aggregateMentions([
      { label: "晨曦科技", type: "organization" },
      { label: "晨曦科技", type: "organization" },
      { label: "蓝海集团", type: "organization" },
    ]);
    expect(agg.get("organization:晨曦科技")?.count).toBe(2);
    expect(agg.get("organization:蓝海集团")?.count).toBe(1);
  });
});
