// @ts-nocheck
// 可观测与通知验收：团队活动流（合并审计 / 分类筛选 / 搜索 / CSV 导出）
// + 团队事件站内通知（角色变更）+ 通知 SSE 实时推送 + 偏好静音。
// Run: npx tsx scripts/smoke/test-team-activity.ts   (requires `pnpm dev` on :3000)
//
// 脚本会临时提升/降回 editor 角色、创建并撤销一个 KB 分享链接，最后恢复
// 偏好与角色（与 test-team-admin 同理，仍建议在干净的 dev 进程上运行）。

import { resolveSmokeBase } from "./lib/base-url";
import { DEMO_PASSWORD } from "./lib/demo";

const BASE = resolveSmokeBase();

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Cookie = `kai-token=${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }

  async function login(email: string): Promise<string> {
    const r = await req("POST", "/api/auth/login", { body: { email, password: DEMO_PASSWORD } });
    if (!r.data?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  // Open an SSE stream and expose waitFor(predicate). Reused by the realtime
  // suite; kept local so this script has no shared mutable state.
  async function openSse(path: string, token: string, timeoutMs = 20_000) {
    const controller = new AbortController();
    const events: any[] = [];
    const ready = new Promise<void>((resolve) => {
      (async () => {
        try {
          const res = await fetch(`${BASE}${path}`, {
            headers: { Cookie: `kai-token=${token}` },
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok || !res.body) { resolve(); return; }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let opened = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const line = raw.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                const e = JSON.parse(line.slice(5).trim());
                if (e?.type) events.push(e);
                if (!opened) { opened = true; resolve(); }
              } catch { /* malformed frame */ }
            }
          }
        } catch { /* aborted */ }
        resolve();
      })();
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      events,
      ready,
      async waitFor(predicate: (e: any) => boolean, deadlineMs = 15_000) {
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
          const hit = events.find(predicate);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      },
      stop() { clearTimeout(timer); controller.abort(); },
    };
  }

  const owner = await login("owner@knowledgeai.dev");
  const admin = await login("admin@knowledgeai.dev");
  const editor = await login("editor@knowledgeai.dev");
  const viewer = await login("viewer@knowledgeai.dev");
  check("setup: four demo roles logged in", !!owner && !!admin && !!editor && !!viewer);

  const team = await req("GET", "/api/team", { token: owner });
  const editorMember = (team.data?.members ?? []).find((m: any) => m.email === "editor@knowledgeai.dev");
  check("setup: editor member id resolved", !!editorMember?.id);

  // ── 1. 活动流权限与合并 ───────────────────────────────────────────────
  console.log("\n── 1. 团队活动流（合并审计 + 权限） ──");
  const denied = await req("GET", "/api/team/activity", { token: viewer });
  check("plain member cannot read team activity (403)", denied.status === 403, `got ${denied.status}`);

  const all = await req("GET", "/api/team/activity?limit=100", { token: owner });
  check("manager reads the unified feed (200)", all.status === 200, `got ${all.status}`);
  const items = all.data?.items ?? [];
  check("feed contains items", items.length > 0);
  check("feed includes team audit actions",
    items.some((i: any) => i.source === "team" && typeof i.action === "string"));
  check("feed counts cover all categories",
    ["member", "permission", "share", "content", "team", "security"].every((k) => typeof all.data?.counts?.[k] === "number"));

  const permission = await req("GET", "/api/team/activity?category=permission&limit=100", { token: owner });
  check("category filter returns only permission items",
    (permission.data?.items ?? []).every((i: any) => i.category === "permission"),
    JSON.stringify((permission.data?.items ?? []).map((i: any) => i.category).slice(0, 5)));

  const search = await req("GET", `/api/team/activity?q=${encodeURIComponent("角色")}&limit=100`, { token: owner });
  check("text search matches action/detail", (search.data?.items ?? []).length > 0);

  const badCategory = await req("GET", "/api/team/activity?category=unknown", { token: owner });
  check("unknown category rejected (400)", badCategory.status === 400, `got ${badCategory.status}`);

  const csv = await fetch(`${BASE}/api/team/activity?format=csv`, {
    headers: { Cookie: `kai-token=${owner}` },
  });
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  const csvText = new TextDecoder("utf-8").decode(csvBytes);
  check("CSV export returns 200", csv.status === 200, `got ${csv.status}`);
  check("CSV content type is text/csv", (csv.headers.get("content-type") ?? "").includes("text/csv"));
  check("CSV starts with a UTF-8 BOM",
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    `${csvBytes[0]},${csvBytes[1]},${csvBytes[2]}`);
  check("CSV header is present", csvText.includes("时间") && csvText.includes("操作者"));
  check("CSV attachment filename set",
    (csv.headers.get("content-disposition") ?? "").includes("team-activity-"));

  // ── 2. 分享事件进入活动流 ─────────────────────────────────────────────
  console.log("\n── 2. 分享事件可观测 ──");
  const kb = await req("POST", "/api/knowledge-base", {
    token: owner, body: { name: `team-activity-${Date.now()}` },
  });
  const kbId = kb.data?.kb?.id;
  check("setup: owner creates a KB", !!kbId, `${kb.status}`);

  const share = await req("POST", `/api/knowledge-base/${kbId}/share`, {
    token: owner, body: { maxViews: 1 },
  });
  check("KB share link created (201)", share.status === 201, `got ${share.status}`);
  const shareActivity = await req("GET", "/api/team/activity?category=share&limit=100", { token: owner });
  check("share-link creation appears in the activity feed",
    (shareActivity.data?.items ?? []).some((i: any) => i.action === "sharelink.create" && i.target === kb.data?.kb?.name));
  await req("DELETE", `/api/knowledge-base/${kbId}/share`, { token: owner });
  await req("DELETE", `/api/knowledge-base/${kbId}`, { token: owner });

  // ── 3. 通知 SSE：角色变更实时到达 ────────────────────────────────────
  console.log("\n── 3. 通知 SSE 实时推送 ──");
  const stream = await openSse("/api/notifications/events", editor);
  await stream.ready;
  const init = await stream.waitFor((e) => e.type === "init");
  check("SSE sends an inbox snapshot on connect", !!init && Array.isArray(init.notifications));

  await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "admin" },
  });
  const live = await stream.waitFor(
    (e) => e.type === "notification" && e.notification?.type === "teamActivity" && /角色/.test(e.notification?.title ?? "")
  );
  check("role change pushes a teamActivity notification over SSE", !!live,
    JSON.stringify(stream.events.slice(-4)));
  await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "editor" },
  });

  // ── 4. 偏好静音 ──────────────────────────────────────────────────────
  console.log("\n── 4. 团队动态偏好静音 ──");
  const prefOff = await req("PATCH", "/api/notifications/preferences", {
    token: editor, body: { teamActivity: false },
  });
  check("teamActivity preference can be disabled", prefOff.status === 200 && prefOff.data?.prefs?.teamActivity === false);

  const beforeMute = await req("GET", "/api/notifications?limit=50", { token: editor });
  const countMuted = (list: any) => (list ?? []).filter((n: any) => n.type === "teamActivity").length;
  const mutedBefore = countMuted(beforeMute.data?.notifications);

  await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "admin" },
  });
  await new Promise((r) => setTimeout(r, 600));
  const afterMute = await req("GET", "/api/notifications?limit=50", { token: editor });
  check("muted channel suppresses new team notifications",
    countMuted(afterMute.data?.notifications) === mutedBefore,
    `${mutedBefore} -> ${countMuted(afterMute.data?.notifications)}`);

  const prefOn = await req("PATCH", "/api/notifications/preferences", {
    token: editor, body: { teamActivity: true },
  });
  check("teamActivity preference restores", prefOn.status === 200 && prefOn.data?.prefs?.teamActivity === true);

  // 恢复角色（若上一步已提升为 admin）
  await req("PATCH", `/api/team/members/${editorMember.id}`, {
    token: owner, body: { role: "editor" },
  });
  stream.stop();

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL ACCEPTANCE CRITERIA PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
