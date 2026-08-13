// ---------------------------------------------------------------------------
// Knowledge Graph (P7-3): entity types shared by extraction / store / RAG.
// ---------------------------------------------------------------------------

export type EntityType = "person" | "organization" | "concept" | "event";

/** A knowledge-graph node: an entity extracted from documents. */
export interface GraphEntity {
  id: string;
  kbId: string;
  label: string;
  type: EntityType;
  /** Total mention count across indexed documents. */
  mentions: number;
  /** Document ids that mention this entity. */
  docIds: string[];
  createdAt: number;
}

/** A knowledge-graph edge: two entities co-occurring in the same sentence. */
export interface GraphRelation {
  id: string;
  kbId: string;
  source: string; // entity label
  target: string; // entity label
  type: string;   // "co-occurs" (sentence co-occurrence)
  weight: number;
  docIds: string[];
  createdAt: number;
}

/** One extracted mention before dedup/merge. */
export interface EntityMention {
  label: string;
  type: EntityType;
}

/** Relations from one document: source -> target label pairs. */
export interface RelationMention {
  source: string;
  target: string;
}
