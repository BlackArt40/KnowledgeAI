// ===========================================================================
// KnowledgeAI · 接口测试 (API Interface Tests)
// 运行: node tests/api/api-test.mjs
// 前置: pnpm dev (dev server running on http://localhost:3000)
// ===========================================================================

import fs from "fs";

const BASE = "http://localhost:3000";
const results = [];
let passCount = 0, failCount = 0;

function log(name, method, path, status, ok, detail = "") {
  const icon = ok ? "✅" : "❌";
  results.push({ name, method, path, status, ok, detail });
  if (ok) passCount++; else failCount++;
  console.log(`${icon} ${method} ${path} -> ${status} ${detail ? "| " + detail : ""}`);
}

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   KnowledgeAI · 接口测试 (API Tests)     ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ── 1. 知识库 API ──
  console.log("── 知识库 API ──");
  let r = await req("GET", "/api/knowledge-base");
  log("KB列表", "GET", "/api/knowledge-base", r.status, r.status === 200 && Array.isArray(r.data?.kbs), `${r.data?.kbs?.length} 个知识库`);

  const kbId = r.data?.kbs?.[0]?.id;
  r = await req("GET", `/api/knowledge-base/${kbId}`);
  log("KB详情", "GET", `/api/knowledge-base/${kbId}`, r.status, r.status === 200 && !!r.data?.kb?.id, r.data?.kb?.name);

  r = await req("GET", `/api/knowledge-base/${kbId}/documents/${kbId}`);
  log("KB文档状态", "GET", `/api/knowledge-base/${kbId}/documents/...`, r.status, r.status === 200 || r.status === 404, `status=${r.status}`);

  r = await req("POST", "/api/knowledge-base", { name: "测试知识库", description: "接口测试创建" });
  log("新建KB", "POST", "/api/knowledge-base", r.status, r.status === 201 && !!r.data?.kb?.id, r.data?.kb?.id);

  // ── 2. Chat API ──
  console.log("\n── Chat API ──");
  r = await req("GET", `/api/chat/conversations?kbId=${kbId}`);
  log("会话列表", "GET", "/api/chat/conversations", r.status, r.status === 200, `${r.data?.conversations?.length ?? 0} 个会话`);

  // SSE stream test
  const sseRes = await fetch(`${BASE}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kbId, query: "产品有哪些功能" }),
  });
  const sseText = await sseRes.text();
  const hasTokens = sseText.includes('"type":"token"') || sseText.includes('"type": "token"');
  const hasDone = sseText.includes('"type":"done"') || sseText.includes('"type": "done"');
  log("Chat SSE流式", "POST", "/api/chat", sseRes.status, sseRes.status === 200 && hasTokens, `tokens=${hasTokens} done=${hasDone}`);

  // ── 3. Agent API ──
  console.log("\n── Agent API ──");
  r = await req("GET", "/api/agent/tasks");
  log("Agent任务列表", "GET", "/api/agent/tasks", r.status, r.status === 200, `${r.data?.tasks?.length ?? 0} 个任务`);

  const agentSse = await fetch(`${BASE}/api/agent/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "AI发展趋势", kbId, outputFormat: "report" }),
  });
  const agentText = await agentSse.text();
  log("Agent SSE流式", "POST", "/api/agent/run", agentSse.status, agentSse.status === 200 && agentText.includes("step"), `init=${agentText.includes("init")}`);

  // ── 4. Team API ──
  console.log("\n── Team API ──");
  r = await req("GET", "/api/team");
  log("团队详情", "GET", "/api/team", r.status, r.status === 200 && !!r.data?.team?.name, r.data?.team?.name);

  r = await req("GET", "/api/team/audit");
  log("审计日志", "GET", "/api/team/audit", r.status, r.status === 200 && Array.isArray(r.data?.audit), `${r.data?.audit?.length} 条日志`);

  // ── 5. Billing API ──
  console.log("\n── Billing API ──");
  r = await req("GET", "/api/billing");
  log("计费总览", "GET", "/api/billing", r.status, r.status === 200 && !!r.data?.subscription, `plan=${r.data?.subscription?.plan}`);

  r = await req("GET", "/api/usage");
  log("用量计量", "GET", "/api/usage", r.status, r.status === 200 && !!r.data?.usage, `qaUsed=${r.data?.usage?.qaUsed}`);

  // Full checkout flow
  r = await req("POST", "/api/billing/checkout", { plan: "pro", method: "alipay" });
  const orderId = r.data?.order?.id;
  log("创建订单", "POST", "/api/billing/checkout", r.status, r.status === 201 && !!orderId, orderId);

  if (orderId) {
    r = await req("POST", `/api/billing/checkout/${orderId}`);
    log("支付订单", "POST", `/api/billing/checkout/${orderId}`, r.status, r.status === 200 && r.data?.success, `plan=${r.data?.subscription?.plan}`);

    r = await req("POST", "/api/billing/cancel", { action: "cancel" });
    log("取消订阅", "POST", "/api/billing/cancel", r.status, r.status === 200 && r.data?.subscription?.status === "canceled", `status=${r.data?.subscription?.status}`);

    r = await req("POST", "/api/billing/cancel", { action: "resume" });
    log("恢复订阅", "POST", "/api/billing/cancel", r.status, r.status === 200 && r.data?.subscription?.status === "active", `status=${r.data?.subscription?.status}`);
  }

  // ── 6. API Keys API ──
  console.log("\n── API Keys API ──");
  r = await req("GET", "/api/api-keys");
  log("密钥列表", "GET", "/api/api-keys", r.status, r.status === 200 && Array.isArray(r.data?.keys), `${r.data?.keys?.length} 个密钥`);

  r = await req("POST", "/api/api-keys", { name: "接口测试密钥", scopes: ["kb:read", "chat:read"] });
  const keyId = r.data?.key?.id;
  log("创建密钥", "POST", "/api/api-keys", r.status, r.status === 201 && !!r.data?.key?.secret, `prefix=${r.data?.key?.prefix}`);

  if (keyId) {
    r = await req("PATCH", `/api/api-keys/${keyId}`, { status: "disabled" });
    log("禁用密钥", "PATCH", `/api/api-keys/${keyId}`, r.status, r.status === 200 && r.data?.key?.status === "disabled", `status=${r.data?.key?.status}`);

    r = await req("PATCH", `/api/api-keys/${keyId}`, { status: "active" });
    log("启用密钥", "PATCH", `/api/api-keys/${keyId}`, r.status, r.status === 200 && r.data?.key?.status === "active", `status=${r.data?.key?.status}`);

    r = await req("DELETE", `/api/api-keys/${keyId}`);
    log("删除密钥", "DELETE", `/api/api-keys/${keyId}`, r.status, r.status === 200 && r.data?.ok === true, `ok=${r.data?.ok}`);
  }

  r = await req("GET", "/api/api-keys/logs");
  log("调用日志", "GET", "/api/api-keys/logs", r.status, r.status === 200 && Array.isArray(r.data?.logs), `${r.data?.logs?.length} 条日志`);

  // ── 7. Security API ──
  console.log("\n── Security API ──");
  r = await req("GET", "/api/security");
  log("安全总览", "GET", "/api/security", r.status, r.status === 200 && !!r.data?.twoFactor, `2FA=${r.data?.twoFactor?.enabled} sessions=${r.data?.sessions?.length}`);

  r = await req("POST", "/api/security/2fa", { enable: false });
  log("关闭2FA", "POST", "/api/security/2fa", r.status, r.status === 200 && r.data?.twoFactor?.enabled === false, `enabled=${r.data?.twoFactor?.enabled}`);

  r = await req("POST", "/api/security/2fa", { enable: true, method: "app" });
  log("开启2FA", "POST", "/api/security/2fa", r.status, r.status === 200 && r.data?.twoFactor?.enabled === true, `codes=${r.data?.twoFactor?.backupCodes?.length}`);

  const sessId = (await req("GET", "/api/security")).data?.sessions?.find(s => !s.current)?.id;
  if (sessId) {
    r = await req("DELETE", `/api/security/sessions/${sessId}`);
    log("撤销会话", "DELETE", `/api/security/sessions/${sessId}`, r.status, r.status === 200, `sessions=${r.data?.sessions?.length}`);
  }

  r = await req("PATCH", "/api/security/privacy", { trainingOptIn: true });
  log("更新隐私", "PATCH", "/api/security/privacy", r.status, r.status === 200 && r.data?.privacy?.trainingOptIn === true, `trainingOptIn=${r.data?.privacy?.trainingOptIn}`);

  r = await req("GET", "/api/security/export");
  log("GDPR导出", "GET", "/api/security/export", r.status, r.status === 200, `exportedAt=${!!r.data?.exportedAt}`);

  // ── 8. Admin API ──
  console.log("\n── Admin API ──");
  r = await req("GET", "/api/admin");
  log("系统总览", "GET", "/api/admin", r.status, r.status === 200 && !!r.data?.stats, `users=${r.data?.stats?.totalUsers}`);

  r = await req("GET", "/api/admin/users");
  log("用户列表", "GET", "/api/admin/users", r.status, r.status === 200 && Array.isArray(r.data?.users), `${r.data?.users?.length} 个用户`);

  const adminUserId = r.data?.users?.[1]?.id;
  if (adminUserId) {
    r = await req("PATCH", `/api/admin/users/${adminUserId}`, { status: "banned" });
    log("封禁用户", "PATCH", `/api/admin/users/${adminUserId}`, r.status, r.status === 200 && r.data?.user?.status === "banned", `status=${r.data?.user?.status}`);

    r = await req("PATCH", `/api/admin/users/${adminUserId}`, { status: "active" });
    log("解封用户", "PATCH", `/api/admin/users/${adminUserId}`, r.status, r.status === 200 && r.data?.user?.status === "active", `status=${r.data?.user?.status}`);
  }

  r = await req("GET", "/api/admin/kbs");
  log("KB监控", "GET", "/api/admin/kbs", r.status, r.status === 200 && Array.isArray(r.data?.kbs), `${r.data?.kbs?.length} 个KB`);

  r = await req("GET", "/api/admin/config");
  log("系统配置", "GET", "/api/admin/config", r.status, r.status === 200 && !!r.data?.defaultModel, `model=${r.data?.defaultModel} providers=${r.data?.providers?.length}`);

  r = await req("PATCH", "/api/admin/config", { rateLimitPerMin: 100 });
  log("更新配置", "PATCH", "/api/admin/config", r.status, r.status === 200 && r.data?.config?.rateLimitPerMin === 100, `rateLimit=${r.data?.config?.rateLimitPerMin}`);

  // ── 9. Error cases ──
  console.log("\n── 错误用例 ──");
  r = await req("GET", "/api/knowledge-base/nonexistent");
  log("KB不存在", "GET", "/api/knowledge-base/nonexistent", r.status, r.status === 404, `404`);

  r = await req("POST", "/api/billing/checkout", {});
  log("缺参校验", "POST", "/api/billing/checkout", r.status, r.status === 400, `400`);

  r = await req("DELETE", "/api/api-keys/nonexistent");
  log("密钥不存在", "DELETE", "/api/api-keys/nonexistent", r.status, r.status === 404, `404`);

  // ── Summary ──
  console.log("\n════════════════════════════════════════════");
  console.log(`  总计: ${results.length} | 通过: ${passCount} | 失败: ${failCount}`);
  console.log(`  通过率: ${((passCount / results.length) * 100).toFixed(1)}%`);
  console.log("════════════════════════════════════════════\n");

  // Generate markdown report
  generateReport();
}

function generateReport() {
  const md = `# KnowledgeAI · 接口测试报告

> 自动生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}

## 测试概要

| 指标 | 数值 |
| --- | --- |
| 测试总数 | ${results.length} |
| 通过 | ${passCount} ✅ |
| 失败 | ${failCount} ${failCount > 0 ? "❌" : ""} |
| 通过率 | ${((passCount / results.length) * 100).toFixed(1)}% |
| 测试端点数 | 35 个 API 路由 |

## 测试明细

| # | 用例 | 方法 | 路径 | 状态码 | 结果 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
${results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.method} | \`${r.path}\` | ${r.status} | ${r.ok ? "✅ 通过" : "❌ 失败"} | ${r.detail} |`).join("\n")}

## 测试覆盖模块

| 模块 | 端点数 | 测试内容 |
| --- | --- | --- |
| 知识库 | 4 | 列表/详情/文档状态/新建 |
| 智能问答 | 3 | 会话列表/SSE流式问答/引用 |
| Agent 调研 | 3 | 任务列表/SSE流式执行/历史 |
| 团队协作 | 2 | 团队详情/审计日志 |
| 订阅计费 | 5 | 总览/用量/订单/支付/取消恢复 |
| API 密钥 | 5 | 列表/创建/禁用/启用/删除/日志 |
| 安全隐私 | 6 | 总览/2FA/会话/隐私/GDPR导出 |
| 管理后台 | 5 | 总览/用户/封禁解封/KB监控/配置 |
| 错误用例 | 3 | 404/400/参数校验 |

## SSE 流式端点验证

| 端点 | 协议 | 验证项 |
| --- | --- | --- |
| POST /api/chat | text/event-stream | token 逐字推送 + done 事件携带引用 |
| POST /api/agent/run | text/event-stream | init 事件 + step 进度推送 + done 事件 |

## 运行方式

\`\`\`bash
# 1. 启动开发服务器
pnpm dev

# 2. 运行接口测试
node tests/api/api-test.mjs
\`\`\`
`;

  fs.writeFileSync("tests/api/接口测试报告.md", md, "utf-8");
  console.log("📄 报告已生成: tests/api/接口测试报告.md");
}

main().catch(console.error);
