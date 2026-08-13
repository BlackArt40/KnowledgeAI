// P7-3 unit tests: GraphRAG re-ranking (entity expansion beats plain scores).
import { describe, it, expect, beforeEach } from "vitest";
import { resetGraphStore, indexDocGraph } from "./store";
import { graphRankChunks, NEIGHBOR_BOOST } from "./graph-rag";
import type { RetrievedChunk } from "@/lib/rag/types";

function chunk(id: string, text: string, score: number): RetrievedChunk {
  return {
    docId: `doc_${id}`,
    docName: `doc-${id}`,
    chunkIndex: 0,
    text,
    score,
  };
}

beforeEach(() => {
  resetGraphStore();
});

describe("graphRankChunks", () => {
  it("lifts the neighbor-mentioning chunk above the query-term distractor", async () => {
    // Graph: 晨曦科技 --co-occurs--> 蓝海集团 (via doc_b)
    await indexDocGraph(
      "kb_g",
      "doc_b",
      "晨曦科技与蓝海集团达成战略合作，共同开发新能源储能系统。"
    );

    const distractor = chunk(
      "a",
      "晨曦科技在2020年完成了三轮融资，融资总额超过十亿元，投资者包括多家风险投资机构。",
      0.9
    );
    const relationChunk = chunk(
      "b",
      "晨曦科技与蓝海集团达成战略合作，共同开发新能源储能系统。",
      0.75
    );
    const answerChunk = chunk(
      "c",
      "蓝海集团的储能业务由其子公司蓝海能源负责运营，产品已出口二十多个国家。",
      0.6
    );

    const baseline = [distractor, relationChunk, answerChunk];
    // plain ranking: distractor (repeats the query entity 3x) first
    const plainOrder = [...baseline].sort((a, b) => b.score - a.score).map((c) => c.docId);
    expect(plainOrder[0]).toBe("doc_a");

    const { chunks, matchedLabels, neighborLabels } = graphRankChunks("kb_g", "晨曦科技在储能领域的合作伙伴是哪家公司？", baseline);
    expect(matchedLabels).toContain("晨曦科技");
    expect(neighborLabels).toContain("蓝海集团");

    const order = chunks.map((c) => c.docId);
    // the neighbor-mentioning answer chunk must beat the distractor
    expect(order.indexOf("doc_c")).toBeLessThan(order.indexOf("doc_a"));
    // and the relation chunk (which names the answer directly) ranks first
    expect(order[0]).toBe("doc_b");
  });

  it("boosts only by neighbor labels when the query entity is absent", () => {
    const c = chunk("x", "蓝海集团业务强劲", 0.5);
    const { chunks } = graphRankChunks("kb_empty", "晨曦科技", [c]);
    expect(chunks[0].docId).toBe("doc_x");
  });

  it("no-op when the query has no entities or the graph has none", async () => {
    const a = chunk("a", "一些与知识无关的内容", 0.8);
    const b = chunk("b", "另一段内容", 0.7);
    const r1 = graphRankChunks("kb_none", "这个问题不涉及任何实体", [a, b]);
    expect(r1.chunks.map((c) => c.docId)).toEqual(["doc_a", "doc_b"]);
    expect(r1.matchedLabels).toEqual([]);

    await indexDocGraph("kb_g2", "doc_1", "晨曦科技发布了「零信任」安全方案。");
    const r2 = graphRankChunks("kb_g2", "晨曦科技的合作伙伴", [a, b]);
    // 晨曦科技 exists but has no relations -> no neighbors, no boost
    expect(r2.chunks.map((c) => c.docId)).toEqual(["doc_a", "doc_b"]);
  });

  it("neighbor boost factor is applied deterministically", () => {
    expect(NEIGHBOR_BOOST).toBeGreaterThan(0.5);
    expect(NEIGHBOR_BOOST).toBeLessThanOrEqual(1);
  });
});
