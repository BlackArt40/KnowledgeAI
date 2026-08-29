// Static SDK exercise script - executed by scripts/smoke/test-sdk.ts with all
// runtime config in the environment (never interpolated into code):
//   KAI_SDK_PATH  file:// URL of sdk/javascript/kai-sdk.mjs
//   KAI_BASE_URL  local dev-server origin
//   KAI_API_KEY   API key created by the parent smoke run
//   KAI_KB_ID     KB to chat against
const { KnowledgeAI } = await import("file://" + process.env.KAI_SDK_PATH);

const kai = new KnowledgeAI({ apiKey: process.env.KAI_API_KEY, baseUrl: process.env.KAI_BASE_URL });
const me = await kai.me();
if (!me.user?.id) throw new Error("me failed: " + JSON.stringify(me));
const list = await kai.listKnowledgeBases();
if (!Array.isArray(list.kbs)) throw new Error("list failed");
const created = await kai.createKnowledgeBase({ name: "SDK JS 测试库" });
if (!created.kb?.id) throw new Error("create failed");
let tokens = "";
const done = await kai.ask(process.env.KAI_KB_ID, "介绍一下这个知识库的内容", { onToken: (t) => (tokens += t) });
if (!done.conversationId) throw new Error("ask failed: " + JSON.stringify(done));
if (tokens.length < 1) throw new Error("no tokens");
const task = await kai.runAgent("一句话总结：大模型的发展", {});
if (!task || task.status !== "done") throw new Error("agent failed: " + JSON.stringify(task));
const whs = await kai.listWebhooks();
if (!Array.isArray(whs.webhooks)) throw new Error("webhooks failed");
const wh = await kai.createWebhook({ name: "sdk", url: "https://example.com/hook", events: ["kb.ready"] });
if (!wh.webhook?.id) throw new Error("webhook create failed");
await kai.deleteWebhook(wh.webhook.id);
console.log("JS_OK me=" + me.user.id + " kbs=" + list.kbs.length + " tokens=" + tokens.length + " task=" + task.status);
