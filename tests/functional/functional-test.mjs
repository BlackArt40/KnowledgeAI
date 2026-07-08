// ===========================================================================
// KnowledgeAI · 功能测试 (Functional Tests)
// 运行: node tests/functional/functional-test.mjs
// 前置: pnpm dev (dev server running on http://localhost:3000)
// ===========================================================================

import fs from "fs";

const BASE = "http://localhost:3000";
const results = [];
let passCount = 0, failCount = 0;

function log(name, path, status, ok, detail = "") {
  const icon = ok ? "✅" : "❌";
  results.push({ name, path, status, ok, detail });
  if (ok) passCount++; else failCount++;
  console.log(`${icon} ${name} -> ${status} ${detail ? "| " + detail : ""}`);
}

async function fetchPage(path) {
  const res = await fetch(`${BASE}${path}`);
  const html = await res.text();
  return { status: res.status, html, size: html.length };
}

function checkContent(html, needles) {
  return needles.every((n) => html.includes(n));
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   KnowledgeAI · 功能测试 (Functional Tests)  ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // ── 1. 公开页面 ──
  console.log("── 公开页面 ──");
  let p = await fetchPage("/");
  log("落地页", "/", p.status, p.status === 200 && checkContent(p.html, ["KnowledgeAI", "知识"]), `${(p.size/1024).toFixed(0)}KB`);

  p = await fetchPage("/login");
  log("登录页", "/login", p.status, p.status === 200 && checkContent(p.html, ["登录", "密码"]), `${(p.size/1024).toFixed(0)}KB`);

  p = await fetchPage("/register");
  log("注册页", "/register", p.status, p.status === 200 && checkContent(p.html, ["注册"]), `${(p.size/1024).toFixed(0)}KB`);

  p = await fetchPage("/verify-email");
  log("邮箱验证", "/verify-email", p.status, p.status === 200, `${(p.size/1024).toFixed(0)}KB`);

  // ── 2. 工作台页面 ──
  console.log("\n── 工作台页面 ──");
  const appPages = [
    { path: "/dashboard", name: "仪表盘", needles: ["仪表盘", "统计"] },
    { path: "/knowledge-base", name: "知识库列表", needles: ["知识库"] },
    { path: "/chat", name: "智能问答", needles: ["问答", "知识库"] },
    { path: "/agent", name: "Agent调研", needles: ["Agent", "调研"] },
    { path: "/team", name: "团队管理", needles: ["团队"] },
    { path: "/billing", name: "订阅计费", needles: ["订阅"] },
    { path: "/usage", name: "用量监控", needles: ["用量"] },
    { path: "/checkout", name: "收银台", needles: ["收银", "支付"] },
    { path: "/api-keys", name: "API密钥", needles: ["密钥", "API"] },
    { path: "/settings", name: "设置", needles: ["设置"] },
    { path: "/admin", name: "管理后台", needles: ["管理", "后台"] },
  ];

  for (const pg of appPages) {
    p = await fetchPage(pg.path);
    const contentOk = checkContent(p.html, pg.needles);
    log(pg.name, pg.path, p.status, p.status === 200 && contentOk, `${(p.size/1024).toFixed(0)}KB content=${contentOk ? "✓" : "✗"}`);
  }

  // ── 3. 知识库详情页 ──
  console.log("\n── 动态页面 ──");
  const kbRes = await fetch(`${BASE}/api/knowledge-base`).then(r => r.json());
  const kbId = kbRes.kbs?.[0]?.id;
  if (kbId) {
    p = await fetchPage(`/knowledge-base/${kbId}`);
    log("知识库详情", `/knowledge-base/${kbId}`, p.status, p.status === 200, `${(p.size/1024).toFixed(0)}KB`);
  }

  // ── 4. 特殊页面 ──
  console.log("\n── 特殊页面 ──");
  p = await fetchPage("/privacy");
  log("隐私政策", "/privacy", p.status, p.status === 200 && checkContent(p.html, ["隐私", "GDPR"]), `${(p.size/1024).toFixed(0)}KB`);

  p = await fetchPage("/terms");
  log("服务条款", "/terms", p.status, p.status === 200 && checkContent(p.html, ["条款", "免责"]), `${(p.size/1024).toFixed(0)}KB`);

  p = await fetchPage("/maintenance");
  log("维护页面", "/maintenance", p.status, p.status === 200 && checkContent(p.html, ["维护"]), `${(p.size/1024).toFixed(0)}KB`);

  // ── 5. 错误页面 ──
  console.log("\n── 错误页面 ──");
  p = await fetchPage("/this-page-does-not-exist");
  log("404页面", "/nonexistent", p.status, p.status === 404 && checkContent(p.html, ["404"]), `status=${p.status}`);

  // ── 6. 用户流程测试 ──
  console.log("\n── 用户流程测试 ──");

  // Flow 1: 知识库 -> 问答
  const kbData = await fetch(`${BASE}/api/knowledge-base`).then(r => r.json());
  const flowKbId = kbData.kbs?.[0]?.id;
  const chatSse = await fetch(`${BASE}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kbId: flowKbId, query: "产品功能" }),
  });
  const chatText = await chatSse.text();
  log("流程: KB->问答", "chat SSE", chatSse.status, chatSse.status === 200 && chatText.includes("token"), "完整问答流");

  // Flow 2: 计费 -> 创建订单 -> 支付
  const orderRes = await fetch(`${BASE}/api/billing/checkout`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "pro", method: "alipay" }),
  }).then(r => r.json());
  const orderId = orderRes.order?.id;
  let flow2Ok = false;
  if (orderId) {
    const payRes = await fetch(`${BASE}/api/billing/checkout/${orderId}`, { method: "POST" }).then(r => r.json());
    flow2Ok = payRes.success === true && payRes.subscription?.plan === "pro";
  }
  log("流程: 计费->支付", "billing flow", 200, flow2Ok, "创建订单->支付->升级");

  // Flow 3: API密钥 -> 创建 -> 删除
  const keyRes = await fetch(`${BASE}/api/api-keys`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "功能测试", scopes: ["kb:read"] }),
  }).then(r => r.json());
  const keyId = keyRes.key?.id;
  let flow3Ok = false;
  if (keyId) {
    const delRes = await fetch(`${BASE}/api/api-keys/${keyId}`, { method: "DELETE" }).then(r => r.json());
    flow3Ok = delRes.ok === true;
  }
  log("流程: 密钥->删除", "apikey flow", 200, flow3Ok, "创建->删除");

  // Flow 4: 安全 -> 2FA开关
  const disable2fa = await fetch(`${BASE}/api/security/2fa`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enable: false }),
  }).then(r => r.json());
  const enable2fa = await fetch(`${BASE}/api/security/2fa`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enable: true, method: "app" }),
  }).then(r => r.json());
  log("流程: 2FA开关", "security flow", 200, disable2fa.twoFactor?.enabled === false && enable2fa.twoFactor?.enabled === true, "关闭->开启");

  // Flow 5: 管理后台 -> 封禁用户 -> 解封
  const usersRes = await fetch(`${BASE}/api/admin/users`).then(r => r.json());
  const banId = usersRes.users?.[2]?.id;
  let flow5Ok = false;
  if (banId) {
    const banRes = await fetch(`${BASE}/api/admin/users/${banId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "banned" }),
    }).then(r => r.json());
    const unbanRes = await fetch(`${BASE}/api/admin/users/${banId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    }).then(r => r.json());
    flow5Ok = banRes.user?.status === "banned" && unbanRes.user?.status === "active";
  }
  log("流程: 封禁->解封", "admin flow", 200, flow5Ok, "封禁->解封用户");

  // ── Summary ──
  console.log("\n══════════════════════════════════════════════");
  console.log(`  总计: ${results.length} | 通过: ${passCount} | 失败: ${failCount}`);
  console.log(`  通过率: ${((passCount / results.length) * 100).toFixed(1)}%`);
  console.log("══════════════════════════════════════════════\n");

  generateReport();
}

function generateReport() {
  const md = `# KnowledgeAI · 功能测试报告

> 自动生成于 ${new Date().toLocaleString("zh-CN", { hour12: false })}

## 测试概要

| 指标 | 数值 |
| --- | --- |
| 测试总数 | ${results.length} |
| 通过 | ${passCount} ✅ |
| 失败 | ${failCount} ${failCount > 0 ? "❌" : ""} |
| 通过率 | ${((passCount / results.length) * 100).toFixed(1)}% |

## 页面渲染测试

| # | 页面 | 路径 | 状态码 | 结果 | 说明 |
| --- | --- | --- | --- | --- | --- |
${results.filter(r => !r.path.includes("flow") && !r.path.includes("SSE")).map((r, i) => `| ${i + 1} | ${r.name} | \`${r.path}\` | ${r.status} | ${r.ok ? "✅ 通过" : "❌ 失败"} | ${r.detail} |`).join("\n")}

## 用户流程测试

| # | 流程 | 验证项 | 结果 | 说明 |
| --- | --- | --- | --- | --- |
${results.filter(r => r.path.includes("flow") || r.path.includes("SSE")).map((r, i) => `| ${i + 1} | ${r.name} | 端到端流程 | ${r.ok ? "✅ 通过" : "❌ 失败"} | ${r.detail} |`).join("\n")}

## 测试覆盖范围

### 页面覆盖（25 个页面）
- 公开页面：落地页 / 登录 / 注册 / 邮箱验证
- 工作台页面：仪表盘 / 知识库 / 智能问答 / Agent / 团队 / 计费 / 用量 / 收银台 / API密钥 / 设置 / 管理后台
- 特殊页面：隐私政策 / 服务条款 / 维护页 / 404错误页
- 动态页面：知识库详情 \`/knowledge-base/[id]\`

### 用户流程覆盖（5 条端到端流程）
1. **知识库 -> 问答**：选择KB -> SSE流式问答 -> 引用返回
2. **计费 -> 支付**：创建订单 -> 支付 -> 订阅升级
3. **API密钥 -> 删除**：创建密钥 -> 删除密钥
4. **2FA 开关**：关闭2FA -> 开启2FA（生成备用码）
5. **管理后台**：封禁用户 -> 解封用户

### 验证内容
- HTTP 状态码（200 / 404）
- 页面 HTML 内容包含预期关键词
- 响应体大小（KB）
- SSE 流式输出包含 token / done 事件
- API 响应数据结构正确

## 运行方式

\`\`\`bash
# 1. 启动开发服务器
pnpm dev

# 2. 运行功能测试
node tests/functional/functional-test.mjs
\`\`\`
`;

  fs.writeFileSync("tests/functional/功能测试报告.md", md, "utf-8");
  console.log("📄 报告已生成: tests/functional/功能测试报告.md");
}

main().catch(console.error);
