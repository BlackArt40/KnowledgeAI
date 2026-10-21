// @ts-nocheck
// 清理 e2e / 手工验证留下的数据（对运行中的服务发 HTTP，不需要连 DB）。
//
// 为什么单独一个脚本：例子里的 e2e 用例即使写了 try/finally，遇到超时、
// 进程被杀、CI 取消时仍会留下 `V3-E2E-KB-* / V4-SSE-* / V4-CHAT-*` 知识库和
// `kai-e2e-*@test.local` 账号，堆在管理端与知识库列表里。
//
// 用法（默认 dry-run，只打印将要删除的对象）：
//   npx tsx scripts/cleanup-e2e-fixtures.ts
//   npx tsx scripts/cleanup-e2e-fixtures.ts --apply
//   BASE_URL=http://localhost:3000 ADMIN_EMAIL=owner@knowledgeai.dev ADMIN_PASSWORD=... \
//     npx tsx scripts/cleanup-e2e-fixtures.ts --apply

import { log } from "../src/lib/obs/log";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "owner@knowledgeai.dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "password123";
const APPLY = process.argv.includes("--apply");

const KB_PREFIXES = ["V3-E2E-KB-", "V4-SSE-", "V4-CHAT-"];
const USER_EMAIL_RE = /^kai-e2e-.*@test\.local$/i;

interface Kb {
  id: string;
  name: string;
}
interface AdminUser {
  id: string;
  email: string;
}

async function login(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    log.error(`[cleanup-e2e] 登录失败 ${email}: HTTP ${res.status}`);
    return null;
  }
  const cookie = res.headers.getSetCookie?.()[0]?.split(";")[0];
  return cookie ?? null;
}

async function getJson<T>(path: string, cookie: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
  if (!res.ok) {
    log.warn(`[cleanup-e2e] GET ${path} -> HTTP ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

async function del(path: string, cookie: string): Promise<boolean> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: { cookie } });
  if (!res.ok && res.status !== 404) {
    log.warn(`[cleanup-e2e] DELETE ${path} -> HTTP ${res.status}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const cookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!cookie) {
    process.exitCode = 1;
    return;
  }

  // 1) 测试知识库
  const kbs = (await getJson<{ kbs?: Kb[] }>("/api/knowledge-base", cookie))?.kbs ?? [];
  const doomedKbs = kbs.filter((kb) => KB_PREFIXES.some((p) => kb.name.startsWith(p)));
  log.info(
    `[cleanup-e2e] 知识库 ${kbs.length} 个，命中测试前缀 ${doomedKbs.length} 个${APPLY ? "" : "（dry-run）"}`
  );
  let deletedKbs = 0;
  for (const kb of doomedKbs) {
    log.info(`  - ${kb.name}`);
    if (APPLY && (await del(`/api/knowledge-base/${encodeURIComponent(kb.id)}`, cookie))) deletedKbs += 1;
  }

  // 2) 测试账号（管理端 DELETE 接口；不能用自助删号，e2e 账号未验证邮箱登录不了）
  const users =
    (await getJson<{ users?: AdminUser[] }>("/api/admin/users", cookie))?.users ?? [];
  const doomedUsers = users.filter((u) => USER_EMAIL_RE.test(u.email));
  log.info(
    `[cleanup-e2e] 用户 ${users.length} 个，命中 e2e 邮箱 ${doomedUsers.length} 个${APPLY ? "" : "（dry-run）"}`
  );
  let deletedUsers = 0;
  for (const u of doomedUsers) {
    log.info(`  - ${u.email}`);
    if (APPLY && (await del(`/api/admin/users/${encodeURIComponent(u.id)}`, cookie))) deletedUsers += 1;
  }

  if (APPLY) {
    log.info(`[cleanup-e2e] 完成：删除知识库 ${deletedKbs}/${doomedKbs.length}，用户 ${deletedUsers}/${doomedUsers.length}`);
  } else {
    log.info("[cleanup-e2e] dry-run 结束；加 --apply 真正删除");
  }
}

main().catch((err) => {
  log.error({ err }, "[cleanup-e2e] 失败");
  process.exitCode = 1;
});
