export type DocStatus =
  | "queued"
  | "parsing"
  | "chunking"
  | "vectorizing"
  | "ready"
  | "failed";

export type DocType = "pdf" | "word" | "markdown" | "text" | "web" | "csv" | "other";

export interface KbDocument {
  id: string;
  kbId: string;
  name: string;
  type: DocType;
  size: number; // bytes; -1 for web links
  status: DocStatus;
  progress: number; // 0-100
  chunks: number;
  url?: string; // for web links
  content?: string; // extracted text for indexing
  uploadedAt: number;
  error?: string;
}

export interface KbSettings {
  chunkSize: number; // tokens per chunk
  chunkOverlap: number; // overlap tokens
  embeddingModel: string;
  topK: number; // retrieval count
}

export interface KnowledgeBase {
  id: string;
  name: string;
  desc: string;
  color: string; // tailwind gradient classes e.g. "from-indigo-500/15"
  initial: string;
  createdAt: number;
  updatedAt: number;
  settings: KbSettings;
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  queued: "排队中",
  parsing: "解析中",
  chunking: "切片中",
  vectorizing: "向量化中",
  ready: "就绪",
  failed: "失败",
};

export const STATUS_ORDER: DocStatus[] = [
  "queued",
  "parsing",
  "chunking",
  "vectorizing",
  "ready",
];

export const EMBEDDING_MODELS = [
  { value: "text-embedding-3-small", label: "OpenAI · text-embedding-3-small" },
  { value: "text-embedding-3-large", label: "OpenAI · text-embedding-3-large" },
  { value: "bge-large-zh", label: "BAAI · bge-large-zh (中文)" },
  { value: "m3e-base", label: "Moka · m3e-base" },
];
