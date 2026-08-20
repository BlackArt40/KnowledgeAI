import { NextResponse } from "next/server";
import { listAllKbs, listDocuments, canViewDoc } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { listAllConversations } from "@/lib/chat/store";
import { listTasks } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getUserById } from "@/lib/auth/store";
import { withApiTrace } from "@/lib/obs/trace";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// P5-2: global search over all core entities for the Cmd+K panel.
//
// Single endpoint: memory stores are Maps, so an O(n) toLowerCase().includes
// scan of the current workspace's entities is sub-millisecond. Everything is
// scoped to the request user's workspace (P4-3 tenant isolation) + document
// / KB visibility, and settings entries are filtered by role. The response
// carries `elapsedMs` (server-side time) so the <100ms acceptance criterion
// can be asserted.
// ---------------------------------------------------------------------------

interface SettingItem {
  id: string;
  label: string;
  keywords: string; // space-separated search keywords
  href: string;
  roles?: Role[]; // undefined = all roles
}

// Settings sections (deep-link via /settings?tab=) + top-level page entries.
const SETTING_ITEMS: SettingItem[] = [
  { id: "sec-2fa", label: "两步验证（2FA）", keywords: "2FA 二次验证 安全 双因素 验证器", href: "/settings?tab=security" },
  { id: "sec-devices", label: "登录设备管理", keywords: "设备 登录 会话 安全", href: "/settings?tab=security" },
  { id: "sec-history", label: "登录历史", keywords: "登录历史 记录 安全", href: "/settings?tab=security" },
  { id: "profile-info", label: "个人信息", keywords: "个人信息 改名 昵称 邮箱 密码", href: "/settings?tab=profile" },
  { id: "profile-notify", label: "通知偏好", keywords: "通知 偏好 提醒 邮件", href: "/settings?tab=profile" },
  { id: "privacy-data", label: "数据与隐私设置", keywords: "隐私 数据 保留期 存储", href: "/settings?tab=privacy" },
  { id: "privacy-gdpr", label: "GDPR 数据权利", keywords: "GDPR 导出 删除 数据权利 隐私", href: "/settings?tab=privacy" },
  { id: "model-llm", label: "AI 模型设置", keywords: "模型 LLM OpenAI DeepSeek Moonshot Ollama 硅基流动", href: "/settings?tab=model" },
  // P5-5: appearance / theme deep-link.
  { id: "appearance-theme", label: "外观与主题", keywords: "外观 主题 暗色 亮色 高对比度 品牌色 无障碍", href: "/settings?tab=appearance" },
  { id: "page-team", label: "团队管理", keywords: "团队 成员 邀请 协作", href: "/team" },
  { id: "page-usage", label: "用量统计", keywords: "用量 统计 配额 存储", href: "/usage", roles: ["owner", "admin", "editor"] },
  { id: "page-apikeys", label: "API 密钥", keywords: "API 密钥 key token 密钥", href: "/api-keys", roles: ["owner", "admin", "editor"] },
  { id: "page-billing", label: "订阅计费", keywords: "订阅 计费 套餐 支付 账单 升级", href: "/billing", roles: ["owner", "admin"] },
  { id: "page-admin", label: "管理后台", keywords: "后台 管理 用户 系统 配置", href: "/admin", roles: ["owner", "admin"] },
];

function matches(q: string, text: string): boolean {
  return text.toLowerCase().includes(q.toLowerCase());
}

/** Prefix matches rank first, then most-recently-updated (via ts()). */
function sortScored<T>(items: T[], score: (t: T) => number, ts: (t: T) => number = () => 0): T[] {
  return items
    .map((t) => ({ t, score: score(t), ts: ts(t) }))
    .filter((s) => s.score !== -1)
    .sort((a, b) => a.score - b.score || b.ts - a.ts)
    .map((s) => s.t);
}

function rankOf(q: string, text: string): number {
  const t = text.toLowerCase();
  const qq = q.toLowerCase();
  if (!t.includes(qq)) return -1;
  return t.startsWith(qq) ? 0 : 1;
}

async function handleSearch(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const start = Date.now();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const LIMIT = 5;

  const results: {
    kbs: { id: string; name: string; desc: string; ownerName: string; shared: boolean; updatedAt: number }[];
    docs: { id: string; kbId: string; kbName: string; name: string; type: string; status: string; url?: string; uploadedAt: number }[];
    conversations: { id: string; kbId: string; title: string; shared?: boolean; updatedAt: number }[];
    tasks: { id: string; topic: string; kbName?: string; status: string; updatedAt: number }[];
    settings: { id: string; label: string; href: string }[];
  } = { kbs: [], docs: [], conversations: [], tasks: [], settings: [] };

  if (q) {
    // ── knowledge bases (workspace-scoped + team visibility) ────────────
    const kbs = sortScored(
      listAllKbs(u.workspaceId).filter((kb) => canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId })),
      (kb) => rankOf(q, kb.name),
      (kb) => kb.updatedAt
    ).slice(0, LIMIT);
    for (const kb of kbs) {
      results.kbs.push({
        id: kb.id,
        name: kb.name,
        desc: kb.desc,
        ownerName: getUserById(kb.ownerId)?.name ?? "未知",
        shared: kb.ownerId !== u.id,
        updatedAt: kb.updatedAt,
      });
    }

    // ── documents (iterate the workspace's KBs, doc-level visibility) ───
    const docs: { d: ReturnType<typeof listDocuments>[number]; kbName: string }[] = [];
    for (const kb of listAllKbs(u.workspaceId)) {
      for (const d of listDocuments(kb.id)) {
        if (canViewDoc(kb, d, u.id, u.workspaceId) && (matches(q, d.name) || (d.url && matches(q, d.url)))) {
          docs.push({ d, kbName: kb.name });
        }
      }
    }
    for (const { d, kbName } of sortScored(docs, ({ d }) => rankOf(q, d.name), ({ d }) => d.uploadedAt).slice(0, LIMIT)) {
      results.docs.push({
        id: d.id,
        kbId: d.kbId,
        kbName,
        name: d.name,
        type: d.type,
        status: d.status,
        ...(d.url ? { url: d.url } : {}),
        uploadedAt: d.uploadedAt,
      });
    }

    // ── conversations (workspace-scoped, P4-3) ──────────────────────────
    results.conversations = sortScored(
      listAllConversations(undefined, u.id).filter(
        (c) => c.workspaceId === u.workspaceId && matches(q, c.title)
      ),
      (c) => rankOf(q, c.title),
      (c) => c.updatedAt
    )
      .slice(0, LIMIT)
      .map((c) => ({ id: c.id, kbId: c.kbId, title: c.title, ...(c.shared ? { shared: true } : {}), updatedAt: c.updatedAt }));

    // ── agent tasks (workspace-scoped via listTasks' workspaceId param) ──
    results.tasks = sortScored(
      listTasks(u.id, u.workspaceId).filter((t) => matches(q, t.topic) || (t.kbName && matches(q, t.kbName))),
      (t) => rankOf(q, t.topic),
      (t) => t.updatedAt
    )
      .slice(0, LIMIT)
      .map((t) => ({ id: t.id, topic: t.topic, ...(t.kbName ? { kbName: t.kbName } : {}), status: t.status, updatedAt: t.updatedAt }));

    // ── settings & page entries (role-filtered) ─────────────────────────
    for (const item of SETTING_ITEMS) {
      if (item.roles && !item.roles.includes(u.role as Role)) continue;
      if (matches(q, item.label) || item.keywords.split(" ").some((k) => k && matches(q, k))) {
        results.settings.push({ id: item.id, label: item.label, href: item.href });
      }
    }
  }

  return NextResponse.json({ query: q, elapsedMs: Date.now() - start, results });
}

// P6-1: request tracing + SLI metrics (api span + status-aware record).
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/search", () => handleSearch(req));
}
