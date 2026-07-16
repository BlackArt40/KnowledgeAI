import {
  type KnowledgeBase,
  type KbDocument,
  type KbSettings,
  type DocType,
  type DocStatus,
} from "./types";
import { indexDocument } from "@/lib/rag/indexer";
import { clearDoc as vsClearDoc, clearKb as vsClearKb } from "@/lib/rag/vector-store";
import { persistKb, persistDoc, deleteKbFromDb, deleteDocFromDb } from "@/lib/db/persist";
import { promises as fs } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// In-memory store (demo). Structured to be swapped for PostgreSQL/Prisma +
// a real LangChain + ChromaDB pipeline. Persisted on globalThis for dev HMR.
// ---------------------------------------------------------------------------

type Store = {
  kbs: Map<string, KnowledgeBase>;
  docs: Map<string, KbDocument>;
  seeded: boolean;
};

const g = globalThis as unknown as { __KAI_KB_STORE__?: Store };

function getStore(): Store {
  if (!g.__KAI_KB_STORE__) {
    g.__KAI_KB_STORE__ = { kbs: new Map(), docs: new Map(), seeded: false };
  } else {
    // HMR migration: KBs created before per-user isolation lack ownerId;
    // assign them to the demo owner so access checks keep working.
    for (const kb of g.__KAI_KB_STORE__.kbs.values()) {
      if (!kb.ownerId) (kb as KnowledgeBase).ownerId = "usr_owner";
    }
  }
  return g.__KAI_KB_STORE__;
}

const DEFAULT_SETTINGS: KbSettings = {
  chunkSize: 500,
  chunkOverlap: 50,
  embeddingModel: "text-embedding-3-small",
  topK: 5,
};

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function docTypeFromName(name: string): DocType {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(doc|docx)$/.test(n)) return "word";
  if (/\.(md|markdown)$/.test(n)) return "markdown";
  if (n.startsWith("http") || n.startsWith("www.")) return "web";
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".txt")) return "text";
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return "image";
  return "other";
}

export function isTextLike(type: DocType): boolean {
  return ["markdown", "text", "csv"].includes(type);
}

function estimateChunks(doc: KbDocument, settings: KbSettings): number {
  if (doc.type === "web") return Math.max(3, Math.round(8 + Math.random() * 6));
  const approxTokens = Math.max(200, Math.round(doc.size / 4));
  return Math.max(1, Math.round(approxTokens / settings.chunkSize));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Processing pipeline.
//
// startProcessing dispatches the doc to the background job queue so the upload
// request returns immediately. The queue handler (src/lib/queue/handlers.ts)
// calls processDocInQueue() which runs the real parse -> chunk -> index
// pipeline with progress updates. Replaces the old in-request setTimeout
// simulator that blocked the request thread.
// ---------------------------------------------------------------------------
function startProcessing(docId: string) {
  void import("@/lib/queue")
    .then(({ enqueue }) => enqueue("doc-process", { docId }))
    .catch((e) => {
      console.error("[kb] failed to enqueue doc-process:", e);
      const doc = getStore().docs.get(docId);
      if (doc) {
        doc.status = "failed";
        doc.error = "排队失败";
      }
    });
}

/**
 * Run the document processing pipeline in the queue worker context.
 * Updates doc status/progress through parsing -> chunking -> vectorizing ->
 * ready, then indexes into the vector + BM25 stores. Exported for the queue
 * handler; request handlers should use addDocument() which enqueues.
 */
export async function processDocInQueue(docId: string): Promise<void> {
  const store = getStore();
  const doc = store.docs.get(docId);
  if (!doc) throw new Error(`Document not found: ${docId}`);

  const setStage = (status: DocStatus, from: number, to: number, progress: number) => {
    const d = store.docs.get(docId);
    if (!d) return;
    d.status = status;
    d.progress = Math.round(from + ((to - from) * progress) / 100);
    store.docs.set(docId, d);
  };

  const tick = async (
    status: DocStatus,
    from: number,
    to: number,
    durationMs: number,
    steps = 10
  ) => {
    for (let i = 1; i <= steps; i++) {
      const d = store.docs.get(docId);
      if (!d || d.status === "failed") return;
      setStage(status, from, to, (i / steps) * 100);
      await sleep(durationMs / steps);
    }
  };

  try {
    await tick("parsing", 2, 30, 1400);

    const kb = store.kbs.get(doc.kbId);
    if (kb && doc.chunks === 0) {
      doc.chunks = estimateChunks(doc, kb.settings ?? DEFAULT_SETTINGS);
    }

    await tick("chunking", 30, 60, 1400);
    await tick("vectorizing", 60, 100, 2000);

    const d = store.docs.get(docId);
    if (!d) return;
    d.status = "ready";
    d.progress = 100;
    store.docs.set(docId, d);

    if (kb) {
      await indexDocument(d, kb.settings).catch((e) =>
        console.error("[kb] index error:", e)
      );
    }
  } catch (err) {
    const d = store.docs.get(docId);
    if (d) {
      d.status = "failed";
      d.error = err instanceof Error ? err.message : "处理失败";
      store.docs.set(docId, d);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Seed (with sample indexed content so chat retrieval works out-of-the-box)
// ---------------------------------------------------------------------------
function seed() {
  const store = getStore();
  if (store.seeded) return;
  store.seeded = true;

  const now = Date.now();
  const seeds: Array<{ name: string; desc: string; color: string; initial: string }> = [
    { name: "产品文档", desc: "产品需求、设计稿与迭代记录", color: "from-indigo-500/15", initial: "产" },
    { name: "API 文档", desc: "OpenAPI 规范与接口说明", color: "from-emerald-500/15", initial: "A" },
    { name: "财务报告", desc: "季度财报与预算明细", color: "from-amber-500/15", initial: "财" },
    { name: "运维手册", desc: "部署、监控与故障排查", color: "from-sky-500/15", initial: "运" },
    { name: "更新日志", desc: "版本发布与变更记录", color: "from-fuchsia-500/15", initial: "更" },
    { name: "HR 政策", desc: "员工手册与制度文件", color: "from-rose-500/15", initial: "H" },
  ];

  const docsSeed: Array<{
    kbName: string; name: string; size: number; status: DocStatus; ageMin: number; content?: string;
  }> = [
    {
      kbName: "产品文档", name: "产品需求文档_v3.pdf", size: 842000, status: "ready", ageMin: 120,
      content:
        "KnowledgeAI 是一款 AI 知识助手 SaaS。核心流程为：上传文档，AI 自动构建知识库，团队基于知识库进行智能问答，并由多 Agent 协作自动生成调研报告。" +
        "产品定位为面向中小团队的企业级知识平台，强调数据隔离与 GDPR 合规。免费版每月 100 次问答，专业版 49 元每月提供无限问答与 Agent 调研，企业版支持私有部署。" +
        "智能问答基于 RAG 流程，回答附带可溯源的引用片段，点击可跳转原文。系统支持流式输出，毫秒级响应。",
    },
    {
      kbName: "产品文档", name: "迭代路线图.docx", size: 156000, status: "ready", ageMin: 240,
      content:
        "第 1-2 周完成落地页与登录注册。第 3-4 周完成知识库管理与文档向量化。第 5-6 周实现智能问答 RAG 核心功能，包括流式输出与引用溯源。" +
        "第 7-8 周实现 Agent 调研与任务队列。Agent 调研由搜索 Agent、分析 Agent、写作 Agent 协作完成，可输出报告、PPT 大纲或思维导图。",
    },
    {
      kbName: "API 文档", name: "鉴权接口说明.md", size: 21000, status: "ready", ageMin: 1500,
      content:
        "KnowledgeAI API 使用 Bearer Token 鉴权。在设置页创建 API 密钥后，将密钥放入 Authorization 请求头。" +
        "接口默认限流为每分钟 60 次请求，专业版提升至 300 次。超过限流返回 429 状态码。" +
        "问答接口 POST /api/chat 接收 knowledge_base_id 与 query，返回流式响应（SSE）。回答中的引用通过 citations 字段返回，包含文档名与片段。",
    },
    {
      kbName: "运维手册", name: "K8s部署手册.md", size: 64000, status: "ready", ageMin: 10080,
      content:
        "KnowledgeAI 通过 Docker 镜像部署，生产环境使用 Kubernetes 编排。前端 Next.js 部署于 Vercel 或自建节点，后端服务运行于 K8s 集群。" +
        "依赖组件包括 PostgreSQL 主数据库、Redis 缓存与任务队列、ChromaDB 向量数据库、对象存储用于文档存储。" +
        "部署步骤：1. 构建镜像并推送至镜像仓库；2. 通过 Helm chart 部署至 K8s；3. 配置 Ingress 与 TLS；4. 执行数据库迁移；5. 健康检查通过后接入流量。",
    },
    { kbName: "产品文档", name: "交互设计稿说明.md", size: 38000, status: "ready", ageMin: 180 },
    { kbName: "API 文档", name: "openapi.yaml", size: 92000, status: "ready", ageMin: 1440 },
    { kbName: "财务报告", name: "2026Q1财报.pdf", size: 1230000, status: "vectorizing", ageMin: 4320 },
    { kbName: "更新日志", name: "CHANGELOG.md", size: 47000, status: "parsing", ageMin: 10080 },
  ];

  const byName = new Map<string, KnowledgeBase>();
  for (const s of seeds) {
    const kb: KnowledgeBase = {
      id: uid("kb"),
      name: s.name,
      desc: s.desc,
      color: s.color,
      initial: s.initial,
      ownerId: "usr_owner",
      createdAt: now - 1000 * 60 * 60 * 24 * 30,
      updatedAt: now,
      settings: { ...DEFAULT_SETTINGS },
    };
    store.kbs.set(kb.id, kb);
    byName.set(kb.name, kb);
  }

  for (const d of docsSeed) {
    const kb = byName.get(d.kbName);
    if (!kb) continue;
    const type = docTypeFromName(d.name);
    const doc: KbDocument = {
      id: uid("doc"),
      kbId: kb.id,
      name: d.name,
      type,
      size: d.size,
      status: d.status,
      progress: d.status === "ready" ? 100 : d.status === "vectorizing" ? 72 : 12,
      chunks: d.status === "ready" ? estimateChunks({ size: d.size, type } as KbDocument, kb.settings) : 0,
      url: undefined,
      content: d.content,
      uploadedAt: now - 1000 * 60 * d.ageMin,
    };
    store.docs.set(doc.id, doc);
    if (d.status === "ready") indexDocument(doc, kb.settings).catch((e) => console.error("[kb] seed index error:", e));
    if (d.status === "vectorizing" || d.status === "parsing") startProcessing(doc.id);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function listKbs(ownerId?: string): KnowledgeBase[] {
  seed();
  const all = Array.from(getStore().kbs.values());
  const filtered = ownerId ? all.filter((kb) => kb.ownerId === ownerId) : all;
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** List ALL knowledge bases regardless of owner (for team-level features). */
export function listAllKbs(): KnowledgeBase[] {
  seed();
  return Array.from(getStore().kbs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getKb(id: string): KnowledgeBase | undefined {
  seed();
  return getStore().kbs.get(id);
}

export function createKb(input: { name: string; desc: string; color?: string; initial?: string }, ownerId: string): KnowledgeBase {
  seed();
  const kb: KnowledgeBase = {
    id: uid("kb"),
    name: input.name.trim() || "未命名知识库",
    desc: input.desc.trim(),
    color: input.color ?? "from-primary/15",
    initial: (input.initial ?? input.name.trim()).charAt(0) || "K",
    ownerId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { ...DEFAULT_SETTINGS },
  };
  getStore().kbs.set(kb.id, kb);
  void persistKb(kb);
  return kb;
}

export function updateKbSettings(id: string, settings: Partial<KbSettings>): KnowledgeBase | undefined {
  seed();
  const kb = getStore().kbs.get(id);
  if (!kb) return undefined;
  kb.settings = { ...kb.settings, ...settings };
  kb.updatedAt = Date.now();
  getStore().kbs.set(id, kb);
  void persistKb(kb);
  return kb;
}

export async function deleteKb(id: string): Promise<boolean> {
  seed();
  const store = getStore();
  for (const [docId, doc] of store.docs) {
    if (doc.kbId === id) store.docs.delete(docId);
  }
  await vsClearKb(id);
  void deleteKbFromDb(id);
  // Clean up local files for this KB (fire-and-forget)
  const kbDir = path.join(process.cwd(), ".uploads", id);
  void fs.rm(kbDir, { recursive: true, force: true }).catch(() => {});
  return store.kbs.delete(id);
}

// Sum of all document sizes across every KB (bytes). Web links (size -1) are
// excluded. Used for real org-level storage metering on the dashboard.
export function totalStorageBytes(ownerId?: string): number {
  seed();
  const kbs = Array.from(getStore().kbs.values());
  const kbIds = new Set(
    (ownerId ? kbs.filter((k) => k.ownerId === ownerId) : kbs).map((k) => k.id)
  );
  let total = 0;
  for (const d of getStore().docs.values()) {
    if (kbIds.has(d.kbId) && d.size > 0) total += d.size;
  }
  return total;
}

export function listDocuments(kbId: string): KbDocument[] {
  seed();
  return Array.from(getStore().docs.values())
    .filter((d) => d.kbId === kbId)
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export function getDocument(docId: string): KbDocument | undefined {
  seed();
  return getStore().docs.get(docId);
}

export function addDocument(input: {
  kbId: string;
  name: string;
  size: number;
  url?: string;
  content?: string;
}): KbDocument {
  seed();
  const store = getStore();
  const kb = store.kbs.get(input.kbId);
  const type = input.url ? "web" : docTypeFromName(input.name);
  const doc: KbDocument = {
    id: uid("doc"),
    kbId: input.kbId,
    name: input.name,
    type,
    size: input.size,
    status: "queued",
    progress: 0,
    chunks: 0,
    url: input.url,
    content: input.content,
    uploadedAt: Date.now(),
  };
  store.docs.set(doc.id, doc);
  void persistDoc(doc);
  if (kb) {
    kb.updatedAt = Date.now();
    store.kbs.set(kb.id, kb);
  }
  startProcessing(doc.id);
  return doc;
}

export async function deleteDocument(docId: string): Promise<boolean> {
  seed();
  const store = getStore();
  const doc = store.docs.get(docId);
  if (doc) await vsClearDoc(doc.kbId, docId);
  if (doc) void deleteDocFromDb(docId);
  return store.docs.delete(docId);
}
