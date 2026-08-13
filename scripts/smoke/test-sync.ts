// @ts-nocheck
// P7-2 acceptance verification: Notion / Confluence document sync.
//
//   1. Local mock Notion (:5090) + mock Confluence (:5091) API servers.
//   2. :3100 production instance configured with NOTION_TOKEN /
//      CONFLUENCE_* env pointing at the mocks.
//   3. POST /api/v1/integrations/sync/{notion,confluence} -> pages land in
//      the KB as documents (queue -> ready), duplicate re-sync skipped.
//   4. Unconfigured instance (:3000 dev) -> 400.
//
// Run: npx tsx scripts/smoke/test-sync.ts   (requires `pnpm dev` on :3000;
//      a prod build with the sync code for :3100)

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const NOTION_PORT = 5090;
const CONFLUENCE_PORT = 5091;
const BASE = "http://localhost:3000";
let failures = 0;
const results: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) results.push(`✅ ${name}`);
  else { results.push(`❌ ${name} ${detail}`); failures++; }
}

// ── Mock Notion API (subset: /v1/databases/{id}/query + /v1/blocks/{id}/children)
function startMockNotion() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${NOTION_PORT}`);
      const json = (o, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.method === "POST" && url.pathname.startsWith("/v1/databases/")) {
        json({
          object: "list",
          results: [
            { id: "page-aaa", properties: { Name: { title: [{ plain_text: "需求文档" }] } } },
            { id: "page-bbb", properties: { 标题: { title: [{ plain_text: "架构设计" }] } } },
          ],
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/v1/blocks/")) {
        const pageId = url.pathname.split("/")[3];
        json({
          object: "list",
          results: pageId === "page-aaa"
            ? [
                { type: "heading_1", heading_1: { rich_text: [{ plain_text: "需求文档" }] } },
                { type: "paragraph", paragraph: { rich_text: [{ plain_text: "核心需求：支持多格式解析。", annotations: { bold: true } }] } },
                { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "PDF" }] } },
                { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Word" }] } },
              ]
            : [
                { type: "heading_2", heading_2: { rich_text: [{ plain_text: "系统架构" }] } },
                { type: "code", code: { rich_text: [{ plain_text: "frontend -> api -> rag" }], language: "text" } },
                { type: "table", table: { children: [
                    { type: "table_row", table_row: { cells: [[{ plain_text: "层" }], [{ plain_text: "说明" }]] } },
                    { type: "table_row", table_row: { cells: [[{ plain_text: "API" }], [{ plain_text: "REST" }]] } },
                  ] } },
              ],
        });
        return;
      }
      json({ error: "not_found" }, 404);
    });
    server.listen(NOTION_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ── Mock Confluence API (subset: /rest/api/content?spaceKey=&expand=body.storage)
function startMockConfluence() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${CONFLUENCE_PORT}`);
      const json = (o, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.method === "GET" && url.pathname === "/rest/api/content") {
        check("mock confluence 收到 spaceKey + expand", url.searchParams.get("spaceKey") === "DEV" && url.searchParams.get("expand") === "body.storage", url.search);
        json({
          results: [
            { id: "c-1", title: "开发规范", body: { storage: { value: "<h2>规范</h2><p>提交信息使用 <strong>Conventional Commits</strong>。</p><ul><li>feat</li><li>fix</li></ul>" } } },
            { id: "c-2", title: "发布流程", body: { storage: { value: "<table><tr><th>环境</th><th>方式</th></tr><tr><td>staging</td><td>自动</td></tr></table>" } } },
          ],
        });
        return;
      }
      json({ error: "not_found" }, 404);
    });
    server.listen(CONFLUENCE_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function spawnConfiguredServer() {
  const env = {
    ...process.env,
    DATABASE_URL: "",
    REDIS_URL: "",
    NEXTAUTH_URL: "",
    AUTH_URL: "http://localhost:3100",
    RATE_LIMIT_PER_MIN: "2000",
    RATE_LIMIT_ANON_PER_MIN: "500",
    RATE_LIMIT_KEY_PER_MIN: "5000",
    RATE_LIMIT_KB_PER_MIN: "1000",
    NOTION_TOKEN: "secret-notion-token",
    NOTION_API_URL: `http://127.0.0.1:${NOTION_PORT}`,
    CONFLUENCE_BASE_URL: `http://127.0.0.1:${CONFLUENCE_PORT}`,
    CONFLUENCE_EMAIL: "dev@example.com",
    CONFLUENCE_TOKEN: "secret-confluence-token",
  };
  const server = spawn("pnpm", ["start", "-p", "3100"], { env, stdio: "ignore" });
  const url = "http://localhost:3100";
  const ready = () =>
    new Promise<boolean>((resolveReady) => {
      const deadline = Date.now() + 60_000;
      const tick = async () => {
        if (Date.now() > deadline) return resolveReady(false);
        try {
          const r = await fetch(`${url}/api/health`);
          if (r.ok) return resolveReady(true);
        } catch { /* not up yet */ }
        setTimeout(tick, 1000);
      };
      tick();
    });
  return { server, url, ready };
}

async function main() {
  console.log("\n── mock 服务器 + :3100 配置实例 ──");
  const mockNotion = await startMockNotion();
  const mockConf = await startMockConfluence();
  const { server, url, ready } = await spawnConfiguredServer();
  check(":3100 实例就绪", await ready());
  if (!(await ready())) { server.kill("SIGTERM"); mockNotion.close(); mockConf.close(); process.exit(1); }

  const login = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
  }).then((r) => r.json());
  check("owner 登录", !!login.token);
  const headers = { "Content-Type": "application/json", Cookie: `kai-token=${login.token}` };

  const kb = await fetch(`${url}/api/knowledge-base`, {
    method: "POST", headers, body: JSON.stringify({ name: "同步验收库" }),
  }).then((r) => r.json());
  const kbId = kb.kb?.id;
  check("创建 KB", !!kbId);

  console.log("\n── Notion 同步 ──");
  const notionRes = await fetch(`${url}/api/v1/integrations/sync/notion`, {
    method: "POST", headers, body: JSON.stringify({ kbId, databaseId: "db-123" }),
  });
  const notionData = await notionRes.json();
  check("notion 同步 200", notionRes.status === 200, `${notionRes.status} ${JSON.stringify(notionData)}`);
  check("notion 导入 2 个（需求文档/架构设计）", notionData.imported === 2, JSON.stringify(notionData));
  check("notion 失败 0", notionData.failed === 0);

  console.log("\n── Confluence 同步 ──");
  const confRes = await fetch(`${url}/api/v1/integrations/sync/confluence`, {
    method: "POST", headers, body: JSON.stringify({ kbId, spaceKey: "DEV" }),
  });
  const confData = await confRes.json();
  check("confluence 同步 200", confRes.status === 200, `${confRes.status} ${JSON.stringify(confData)}`);
  check("confluence 导入 2 个（开发规范/发布流程）", confData.imported === 2, JSON.stringify(confData));

  console.log("\n── 重跑去重 + 文档就绪 ──");
  const reNotion = await fetch(`${url}/api/v1/integrations/sync/notion`, {
    method: "POST", headers, body: JSON.stringify({ kbId, databaseId: "db-123" }),
  }).then((r) => r.json());
  check("重跑 notion -> 全部跳过（按名去重）", reNotion.imported === 0 && reNotion.skipped === 2, JSON.stringify(reNotion));

  let allReady = false;
  let lastDocs: { name: string; status: string }[] = [];
  for (let i = 0; i < 40 && !allReady; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const detail = await fetch(`${url}/api/knowledge-base/${kbId}`, { headers }).then((r) => r.json());
    const docs = detail.docs ?? [];
    lastDocs = docs.map((d) => ({ name: d.name, status: d.status }));
    allReady = docs.length === 4 && docs.every((d) => d.status === "ready");
  }
  check("4 个同步文档全部 ready", allReady, JSON.stringify(lastDocs));

  // searchable: ask a question grounded in the imported content (demo mode)
  const chatRes = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `kai-token=${login.token}` },
    body: JSON.stringify({ kbId, query: "发布流程中 staging 环境如何部署？" }),
  });
  const chatText = await chatRes.text();
  check("同步内容可检索（问答引用导入文档）", chatRes.status === 200 && (chatText.includes("staging") || chatText.includes("自动") || chatText.includes("发布流程")), chatText.slice(0, 200));

  console.log("\n── 校验与审计 ──");
  const audit = await (await fetch(`${url}/api/admin/audit?action=integration.sync`, { headers })).json();
  check("审计 integration.sync ≥2（notion+confluence）", (audit.audit ?? []).length >= 2, JSON.stringify(audit.audit?.length));

  // invalid inputs
  const noDb = await fetch(`${url}/api/v1/integrations/sync/notion`, {
    method: "POST", headers, body: JSON.stringify({ kbId }),
  });
  check("缺 databaseId -> 400", noDb.status === 400, String(noDb.status));
  const noKb = await fetch(`${url}/api/v1/integrations/sync/confluence`, {
    method: "POST", headers, body: JSON.stringify({ kbId: "kb_nope", spaceKey: "DEV" }),
  });
  check("KB 不存在 -> 404", noKb.status === 404, String(noKb.status));

  console.log("\n── 未配置实例（:3000）──");
  const refLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
  }).then((r) => r.json());
  const refKb = await fetch(`${BASE}/api/knowledge-base`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `kai-token=${refLogin.token}` },
    body: JSON.stringify({ name: "同步未配置库" }),
  }).then((r) => r.json());
  const unconf = await fetch(`${BASE}/api/v1/integrations/sync/notion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `kai-token=${refLogin.token}` },
    body: JSON.stringify({ kbId: refKb.kb?.id, databaseId: "db-1" }),
  });
  check("未配置实例 -> 400（无 NOTION_TOKEN）", unconf.status === 400, `${unconf.status} ${await unconf.text()}`);

  server.kill("SIGTERM");
  mockNotion.close();
  mockConf.close();
  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ Sync acceptance: ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
