// @ts-nocheck
// P6-2 acceptance verification (pure-lib + local receiver): structured
// logging internals.
//   - redaction: top-level AND nested sensitive keys censored (ring + Loki
//     payload), redactText() masks free-text secret shapes
//   - err serializer: Error -> {type, message, stack}
//   - requestId correlation via the ALS trace context (runWithTraceId)
//   - level filtering (setLogLevel) - dropped lines never reach the sink
//   - Loki HTTP Push: LOG_LOKI_URL gated, correct URL/body/streams shape;
//     no URL -> zero network; push failure (500) -> dropped, no throw
//   - recentLogs() ring filters (level / requestId)
// Pure-lib test (test-sentry pattern) - no dev server needed.
// Run: npx tsx scripts/smoke/test-logging-sink.ts

import { createServer } from "node:http";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 0. 本地 receiver + 环境 ──────────────────────────────────────────
  const pushes = [];
  let failMode = false;
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (failMode) { res.writeHead(500); res.end("boom"); return; }
      pushes.push({ url: req.url, headers: req.headers, body });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
  const port = receiver.address().port;
  process.env.LOG_LOKI_URL = `http://127.0.0.1:${port}`;

  // Import AFTER env is set (destination reads the URL lazily anyway).
  const { log, setLogLevel, getLogLevel, recentLogs, flushLogs, redactText, isLokiEnabled } =
    await import("../../src/lib/obs/log");
  const { runWithTraceId } = await import("../../src/lib/obs/trace");

  setLogLevel("debug");
  check("初始级别 debug", getLogLevel() === "debug", getLogLevel());
  check("isLokiEnabled()=true", isLokiEnabled() === true);

  // ── 1. 脱敏（顶层 + 嵌套）+ err 序列化 + requestId ──────────────────
  console.log("\n── 1. 脱敏 / err 序列化 / requestId ──");
  const SECRET = "sk-test-abcdef1234567890";
  const PASSWORD = "hunter2secret";
  const TOKEN = "tok-xyz-secret";
  log.info("outside trace"); // no ALS context -> no requestId
  await runWithTraceId("rid-sink-1", "sink-test", async () => {
    log.info({ apiKey: SECRET, nested: { apiKey: SECRET }, deep: { a: { token: TOKEN } } }, "secrets log");
    log.error({ err: new Error("boom stack"), password: PASSWORD, authorization: `Bearer ${TOKEN}` }, "err log");
    log.info("plain inside trace");
  });
  await flushLogs();

  check("receiver 收到 1 次 push", pushes.length === 1, `pushes=${pushes.length}`);
  const push = pushes[0];
  check("push URL = /loki/api/v1/push", push.url === "/loki/api/v1/push", push.url);
  check("push Content-Type = application/json", push.headers["content-type"]?.includes("application/json"), push.headers["content-type"]);
  const payload = JSON.parse(push.body);
  check("streams[0].stream.app = knowledgeai", payload.streams?.[0]?.stream?.app === "knowledgeai", JSON.stringify(payload).slice(0, 120));
  const values = payload.streams?.[0]?.values ?? [];
  check("values 为 [ns, jsonLine] 对", values.length > 0 && values.every((v) => Array.isArray(v) && v.length === 2 && /^\d+$/.test(v[0])), `n=${values.length}`);
  const lines = values.map((v) => JSON.parse(v[1]));

  // 脱敏：raw body 与解析行都不得含密钥原文
  const rawBody = push.body;
  check("Loki 载荷不含 apiKey 原文", !rawBody.includes(SECRET));
  check("Loki 载荷不含 password 原文", !rawBody.includes(PASSWORD));
  check("Loki 载荷不含 token 原文", !rawBody.includes(TOKEN));
  const secretsLog = lines.find((l) => l.msg === "secrets log");
  check("顶层 apiKey 已脱敏", secretsLog && secretsLog.apiKey === "***", JSON.stringify(secretsLog).slice(0, 200));
  check("嵌套 apiKey 已脱敏（1 级）", secretsLog && secretsLog.nested?.apiKey === "***");
  check("深嵌套 token 已脱敏（2 级）", secretsLog && secretsLog.deep?.a?.token === "***");

  const errLog = lines.find((l) => l.msg === "err log");
  check("err 序列化为 {type,message,stack}", errLog && errLog.err?.type === "Error" && errLog.err?.message === "boom stack" && typeof errLog.err?.stack === "string");
  check("password 字段脱敏", errLog && errLog.password === "***");
  check("authorization 字段脱敏", errLog && errLog.authorization === "***");

  check("请求内日志带 requestId", lines.some((l) => l.msg === "plain inside trace" && l.requestId === "rid-sink-1"));
  const outside = lines.find((l) => l.msg === "outside trace");
  check("trace 外日志无 requestId 字段", !!outside && !("requestId" in outside), JSON.stringify(outside));

  // ── 2. recentLogs 环过滤 ─────────────────────────────────────────────
  console.log("\n── 2. recentLogs 环 ──");
  const byRid = recentLogs({ requestId: "rid-sink-1" });
  check("recentLogs(requestId) 命中", byRid.length >= 3 && byRid.every((e) => e.requestId === "rid-sink-1"), `n=${byRid.length}`);
  const warnOnly = recentLogs({ level: "warn" });
  check("recentLogs(level=warn) 无 info", warnOnly.every((e) => e.level === "warn" || e.level === "error" || e.level === "fatal"), warnOnly.map((e) => e.level).join(","));
  check("recentLogs 条目已脱敏（环内存的是 redact 后行）", !JSON.stringify(byRid).includes(SECRET) && !JSON.stringify(byRid).includes(PASSWORD));

  // ── 3. redactText 自由文本 ──────────────────────────────────────────
  console.log("\n── 3. redactText ──");
  check("redactText: sk- key", redactText(`err ${SECRET} here`) === `err sk-*** here`);
  check("redactText: Bearer", redactText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123") === "Authorization: Bearer ***");
  check("redactText: key=value", redactText("password=hunter2secret end") === "password=*** end");
  check("redactText: key: value", redactText("api_key: hunter2secret") === "api_key: ***");
  check("redactText: URL userinfo", redactText("postgres://admin:pass@db:5432/x") === "postgres://***@db:5432/x");
  check("redactText: 截断", redactText("a".repeat(600), 500).endsWith("…(truncated)"));
  check("redactText: 普通文本不变", redactText("正常文本 hello world") === "正常文本 hello world");

  // ── 4. 分级过滤 ─────────────────────────────────────────────────────
  console.log("\n── 4. 分级过滤 ──");
  const before = pushes.length;
  setLogLevel("error");
  log.info("should-be-dropped-info");
  log.debug("should-be-dropped-debug");
  log.error({ err: "keep" }, "kept-error");
  await flushLogs();
  const afterLines = pushes.length > before ? JSON.parse(pushes[pushes.length - 1].body).streams[0].values.map((v) => JSON.parse(v[1])) : [];
  check("error 级别下 info/debug 被丢弃", !afterLines.some((l) => l.msg.startsWith("should-be-dropped")), afterLines.map((l) => l.msg).join(","));
  check("error 级别下 error 保留", afterLines.some((l) => l.msg === "kept-error"));
  setLogLevel("debug");
  log.info("back-to-info");
  await flushLogs();
  const backLines = JSON.parse(pushes[pushes.length - 1].body).streams[0].values.map((v) => JSON.parse(v[1]));
  check("恢复 debug 后 info 恢复", backLines.some((l) => l.msg === "back-to-info"), backLines.map((l) => l.msg).join(","));

  // ── 5. 推送失败容忍 ─────────────────────────────────────────────────
  console.log("\n── 5. 推送失败容忍 ──");
  failMode = true;
  let threw = false;
  try {
    log.warn("will-fail-push");
    await flushLogs();
  } catch {
    threw = true;
  }
  check("Loki 500 不抛异常", !threw);
  failMode = false;
  log.info("after-failure");
  await flushLogs();
  const afterFail = pushes[pushes.length - 1] ? JSON.parse(pushes[pushes.length - 1].body).streams[0].values.map((v) => JSON.parse(v[1])) : [];
  check("失败后恢复推送", afterFail.some((l) => l.msg === "after-failure"), `pushes=${pushes.length}`);

  // ── 6. 未配置 URL = 零网络 ──────────────────────────────────────────
  console.log("\n── 6. 未配置 URL = 零网络 ──");
  process.env.LOG_LOKI_URL = "";
  const beforeNoUrl = pushes.length;
  log.info("no-url-line");
  await flushLogs();
  await sleep(100);
  check("LOG_LOKI_URL 未设置时零网络请求", pushes.length === beforeNoUrl, `pushes=${pushes.length}`);
  check("isLokiEnabled()=false", isLokiEnabled() === false);

  // ── 汇总 ────────────────────────────────────────────────────────────
  receiver.close();
  console.log(`\n${results.join("\n")}`);
  console.log(`\nLogging sink acceptance: ${results.length - failures}/${results.length} passed, ${failures} FAILED`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
