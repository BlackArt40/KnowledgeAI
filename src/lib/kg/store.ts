// ---------------------------------------------------------------------------
// Knowledge-graph store (P7-3).
//
// In-memory graph on globalThis (source of truth for reads) with write-through
// persistence (persistEntity / persistRelation / deleteEntityFromDb /
// deleteRelationFromDb). Entities and relations are keyed by stable ids
// derived from (kbId, label) / (kbId, source, target) so upserts are idempotent.
// ---------------------------------------------------------------------------

import type { GraphEntity, GraphRelation } from "./types";
import { extractEntities, extractRelations, aggregateMentions } from "./extract";
import { persistEntity, persistRelation, deleteEntityFromDb, deleteRelationFromDb } from "@/lib/db/persist";

interface StoreShape {
  entities: Map<string, GraphEntity>;
  relations: Map<string, GraphRelation>;
  /** label -> entity id (per KB, for label lookup). */
  labelIndex: Map<string, string>;
  /** kbId -> docId -> per-doc contribution (entityIds + TRUE per-label mention
   *  counts). Keeping the real counts here lets doc removal subtract exactly
   *  what the doc contributed, instead of averaging (which drifts). */
  docGraphs: Map<string, Map<string, { entityIds: string[]; relationIds: string[]; entityMentions: Map<string, number> }>>;
}

declare global {
  var __KAI_GRAPH_STORE__: StoreShape | undefined;
}

function store(): StoreShape {
  if (!globalThis.__KAI_GRAPH_STORE__) {
    globalThis.__KAI_GRAPH_STORE__ = { entities: new Map(), relations: new Map(), labelIndex: new Map(), docGraphs: new Map() };
  }
  return globalThis.__KAI_GRAPH_STORE__;
}

export function resetGraphStore(): void {
  delete globalThis.__KAI_GRAPH_STORE__;
}

function entityId(kbId: string, label: string): string {
  return `ent_${stableHash(`${kbId}:${label}`)}`;
}
function relationId(kbId: string, source: string, target: string): string {
  return `rel_${stableHash(`${kbId}:${source}:${target}`)}`;
}

/** FNV-1a 32-bit hex - stable across processes (no crypto needed). */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Indexing ──────────────────────────────────────────────────────────────

/**
 * Index one document into the KB graph: extract entities + sentence
 * co-occurrence relations, then incrementally merge (per-doc contribution is
 * tracked so re-indexing a doc is idempotent and deleting a doc removes it).
 */
export async function indexDocGraph(kbId: string, docId: string, text: string): Promise<{
  entities: number;
  relations: number;
}> {
  const s = store();
  if (!text || text.trim().length < 6) return { entities: 0, relations: 0 };

  // 1. remove this doc's previous contribution (idempotent re-index)
  removeDocContribution(kbId, docId);

  const mentions = extractEntities(text);
  const relationPairs = extractRelations(text, mentions);
  if (mentions.length === 0 && relationPairs.length === 0) return { entities: 0, relations: 0 };

  const agg = aggregateMentions(mentions);
  const entityIds: string[] = [];
  const relationIds: string[] = [];
  // label -> count for THIS doc (used by removeDocContribution to subtract
  // exact numbers instead of the mentions/docIds heuristic).
  const docMentionCounts = new Map<string, number>();
  for (const m of mentions) {
    docMentionCounts.set(m.label, (docMentionCounts.get(m.label) ?? 0) + 1);
  }

  // 2. merge entities
  for (const [, m] of agg) {
    const id = entityId(kbId, m.label);
    const existing = s.entities.get(id);
    const entity: GraphEntity = existing
      ? {
          ...existing,
          mentions: existing.mentions + m.count,
          docIds: existing.docIds.includes(docId) ? existing.docIds : [...existing.docIds, docId],
        }
      : {
          id,
          kbId,
          label: m.label,
          type: m.type,
          mentions: m.count,
          docIds: [docId],
          createdAt: Date.now(),
        };
    s.entities.set(id, entity);
    s.labelIndex.set(`${kbId}:${m.label}`, id);
    entityIds.push(id);
    void persistEntity(entity);
  }

  // 3. merge relations (undirected: source/target normalized)
  const relSeen = new Set<string>();
  for (const r of relationPairs) {
    const [a, b] = r.source < r.target ? [r.source, r.target] : [r.target, r.source];
    const key = `${a}\u0000${b}`;
    if (relSeen.has(key)) continue;
    relSeen.add(key);
    const id = relationId(kbId, a, b);
    const existing = s.relations.get(id);
    const relation: GraphRelation = existing
      ? {
          ...existing,
          weight: existing.weight + 1,
          docIds: existing.docIds.includes(docId) ? existing.docIds : [...existing.docIds, docId],
        }
      : {
          id,
          kbId,
          source: a,
          target: b,
          type: "co-occurs",
          weight: 1,
          docIds: [docId],
          createdAt: Date.now(),
        };
    s.relations.set(id, relation);
    relationIds.push(id);
    void persistRelation(relation);
  }

  // 4. track per-doc contribution for future incremental updates
  let docMap = s.docGraphs.get(kbId);
  if (!docMap) {
    docMap = new Map();
    s.docGraphs.set(kbId, docMap);
  }
  docMap.set(docId, { entityIds, relationIds, entityMentions: docMentionCounts });

  return { entities: entityIds.length, relations: relationIds.length };
}

/** Remove one doc's contribution (entities/relations it alone created). */
export function removeDocContribution(kbId: string, docId: string): void {
  const s = store();
  const docMap = s.docGraphs.get(kbId);
  if (!docMap) return;
  const contribution = docMap.get(docId);
  if (!contribution) return;
  docMap.delete(docId);

  for (const id of contribution.entityIds) {
    const e = s.entities.get(id);
    if (!e) continue;
    const next = {
      ...e,
      mentions: Math.max(0, e.mentions - (contribution.entityMentions.get(e.label) ?? 0)),
      docIds: e.docIds.filter((d) => d !== docId),
    };
    if (next.docIds.length === 0) {
      s.entities.delete(id);
      void deleteEntityFromDb(id);
    } else {
      s.entities.set(id, next);
      void persistEntity(next);
    }
  }
  for (const id of contribution.relationIds) {
    const r = s.relations.get(id);
    if (!r) continue;
    const next = { ...r, weight: Math.max(1, r.weight - 1), docIds: r.docIds.filter((d) => d !== docId) };
    if (next.docIds.length === 0) {
      s.relations.delete(id);
      void deleteRelationFromDb(id);
    } else {
      s.relations.set(id, next);
      void persistRelation(next);
    }
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────

export function getGraph(kbId: string): { entities: GraphEntity[]; relations: GraphRelation[] } {
  const s = store();
  return {
    entities: [...s.entities.values()].filter((e) => e.kbId === kbId).sort((a, b) => b.mentions - a.mentions),
    relations: [...s.relations.values()].filter((r) => r.kbId === kbId).sort((a, b) => b.weight - a.weight),
  };
}

export function getEntityByLabel(kbId: string, label: string): GraphEntity | undefined {
  const s = store();
  const id = s.labelIndex.get(`${kbId}:${label}`);
  return id ? s.entities.get(id) : undefined;
}

/**
 * Expand a set of entity labels by up to `hops` graph edges. Returns the
 * neighbor labels with their aggregate edge weight (used by GraphRAG).
 */
export function expandEntities(
  kbId: string,
  labels: string[],
  hops = 1,
  maxNeighbors = 8
): Map<string, number> {
  const s = store();
  const expanded = new Map<string, number>();
  const frontier = new Set(labels);
  const visited = new Set(labels);
  for (let hop = 0; hop < hops; hop++) {
    const next = new Set<string>();
    for (const label of frontier) {
      const id = s.labelIndex.get(`${kbId}:${label}`);
      if (!id) continue;
      const entity = s.entities.get(id);
      if (!entity) continue;
      // relations touching this entity (labels normalized at insert)
      for (const rel of s.relations.values()) {
        if (rel.kbId !== kbId) continue;
        if (rel.source !== label && rel.target !== label) continue;
        const other = rel.source === label ? rel.target : rel.source;
        if (visited.has(other)) continue;
        visited.add(other);
        next.add(other);
        expanded.set(other, (expanded.get(other) ?? 0) + rel.weight);
      }
    }
    if (next.size === 0) break;
    frontier.clear();
    for (const n of next) frontier.add(n);
  }
  // keep the strongest neighbors
  const ranked = [...expanded.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxNeighbors);
  return new Map(ranked);
}

export function clearKbGraph(kbId: string): void {
  const s = store();
  for (const [id, e] of s.entities) {
    if (e.kbId === kbId) {
      s.entities.delete(id);
      void deleteEntityFromDb(id);
    }
  }
  for (const [id, r] of s.relations) {
    if (r.kbId === kbId) {
      s.relations.delete(id);
      void deleteRelationFromDb(id);
    }
  }
  for (const [key] of s.labelIndex) {
    if (key.startsWith(`${kbId}:`)) s.labelIndex.delete(key);
  }
  s.docGraphs.delete(kbId);
}
/** Entity search within a KB (for the graph search API). */
export function searchEntities(kbId: string, q: string, limit = 20): GraphEntity[] {
  const s = store();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return [...s.entities.values()]
    .filter((e) => e.kbId === kbId && e.label.toLowerCase().includes(needle))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit);
}

// keep the import used (extractEntities is re-exported for callers)
export { extractEntities, extractRelations, aggregateMentions } from "./extract";
