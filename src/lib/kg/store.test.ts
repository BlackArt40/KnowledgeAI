// P7-3 unit tests: graph store (incremental doc indexing + entity expansion).
import { describe, it, expect, beforeEach } from "vitest";
import {
  resetGraphStore,
  indexDocGraph,
  getGraph,
  getEntityByLabel,
  expandEntities,
  searchEntities,
  clearKbGraph,
} from "./store";

beforeEach(() => {
  resetGraphStore();
});

describe("indexDocGraph", () => {
  it("extracts entities + co-occurrence relations from a document", async () => {
    const text =
      "晨曦科技与蓝海集团签署战略合作协议。晨曦科技专注于云计算平台。星辰支付公司独立运营支付业务。";
    const result = await indexDocGraph("kb_1", "doc_1", text);
    expect(result.entities).toBeGreaterThanOrEqual(3);
    expect(result.relations).toBeGreaterThanOrEqual(1);

    const graph = getGraph("kb_1");
    expect(graph.entities.some((e) => e.label === "晨曦科技" && e.type === "organization")).toBe(true);
    expect(graph.entities.some((e) => e.label === "蓝海集团")).toBe(true);
    // relation between the two orgs that share a sentence
    expect(
      graph.relations.some(
        (r) => r.source === "晨曦科技" && r.target === "蓝海集团" && r.weight >= 1
      )
    ).toBe(true);
    // 星辰支付公司 is alone in its sentence -> no relation to the pair
    expect(
      graph.relations.some((r) => r.source === "晨曦科技" && r.target === "星辰支付公司")
    ).toBe(false);
  });

  it("merges mention counts on re-index and removes doc contribution", async () => {
    await indexDocGraph("kb_1", "doc_1", "晨曦科技发布新品。");
    const e1 = getEntityByLabel("kb_1", "晨曦科技");
    expect(e1?.mentions).toBe(1);

    await indexDocGraph("kb_1", "doc_1", "晨曦科技发布新品。晨曦科技再获融资。");
    const e2 = getEntityByLabel("kb_1", "晨曦科技");
    // remove old contribution (1) + add new (2)
    expect(e2?.mentions).toBe(2);
    expect(e2?.docIds).toEqual(["doc_1"]);
  });

  it("subtracts EXACT per-doc mention counts across multiple docs", async () => {
    // doc_a mentions 晨曦科技 3x, doc_b 1x -> total 4
    await indexDocGraph(
      "kb_m",
      "doc_a",
      "晨曦科技专注云计算。晨曦科技总部位于上海。晨曦科技员工两千人。"
    );
    await indexDocGraph("kb_m", "doc_b", "晨曦科技发布了年度报告。");
    expect(getEntityByLabel("kb_m", "晨曦科技")?.mentions).toBe(4);

    // remove doc_a -> must drop exactly its 3 mentions, leaving doc_b's 1
    const { removeDocContribution } = await import("./store");
    removeDocContribution("kb_m", "doc_a");
    const after = getEntityByLabel("kb_m", "晨曦科技");
    expect(after?.mentions).toBe(1);
    expect(after?.docIds).toEqual(["doc_b"]);

    // removing the last doc drops the entity entirely
    removeDocContribution("kb_m", "doc_b");
    expect(getEntityByLabel("kb_m", "晨曦科技")).toBeUndefined();
  });

  it("entities accumulate across docs; clearKbGraph wipes the KB", async () => {
    await indexDocGraph("kb_1", "doc_a", "晨曦科技与蓝海集团合作。");
    await indexDocGraph("kb_1", "doc_b", "星辰支付公司完成新一轮融资。");
    await indexDocGraph("kb_2", "doc_x", "华东大学发布招生简章。");
    expect(getGraph("kb_1").entities.length).toBe(3);
    expect(getGraph("kb_2").entities.length).toBe(1);
    clearKbGraph("kb_1");
    expect(getGraph("kb_1").entities.length).toBe(0);
    expect(getGraph("kb_1").relations.length).toBe(0);
    expect(getGraph("kb_2").entities.length).toBe(1);
  });

  it("ignores too-short documents", async () => {
    const result = await indexDocGraph("kb_1", "doc_1", "短");
    expect(result.entities).toBe(0);
  });
});

describe("expandEntities", () => {
  it("expands 1 hop along relations with aggregate weights", async () => {
    await indexDocGraph("kb_1", "doc_a", "晨曦科技与蓝海集团合作。蓝海集团与星辰支付公司签约。晨曦科技与星辰支付公司交流。");
    const expanded = expandEntities("kb_1", ["晨曦科技"]);
    expect(expanded.get("蓝海集团")).toBeGreaterThanOrEqual(1);
    expect(expanded.get("星辰支付公司")).toBeGreaterThanOrEqual(1);
    // the direct partner has the higher weight
    expect(expanded.get("蓝海集团")!).toBeGreaterThanOrEqual(expanded.get("星辰支付公司")!);
  });

  it("returns nothing for unknown labels", () => {
    expect(expandEntities("kb_1", ["不存在的实体"], 1).size).toBe(0);
  });
});

describe("searchEntities", () => {
  it("substring search scoped to the KB", async () => {
    await indexDocGraph("kb_1", "doc_a", "晨曦科技与蓝海集团合作。");
    const hits = searchEntities("kb_1", "晨曦");
    expect(hits.length).toBe(1);
    expect(hits[0].label).toBe("晨曦科技");
    expect(searchEntities("kb_2", "晨曦")).toEqual([]);
  });
});
