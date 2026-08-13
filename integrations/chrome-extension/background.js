// KnowledgeAI Chrome 扩展 - 后台 Service Worker (MV3)
// 选中网页文字 -> 右键菜单「发送到 KnowledgeAI 问答」-> 打开结果页问答。
// 配置（API Key / 知识库 / 服务地址）在 options.html 中填写，存 chrome.storage。

const MENU_ID = "kai-ask-selection";

async function ensureMenu() {
  if (chrome.runtime.lastError) return; // already exists
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: "发送到 KnowledgeAI 问答",
      contexts: ["selection"],
    },
    () => void chrome.runtime.lastError
  );
}

chrome.runtime.onInstalled.addListener(ensureMenu);
chrome.runtime.onStartup.addListener(ensureMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  // 选中文本 -> storage -> 打开结果页（避免把 API Key 塞进 URL）。
  chrome.storage.local.set({ kaiPendingQuery: info.selectionText.trim() }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("result.html") });
  });
});

// 结果页请求问答的桥接（content 页直接 fetch 会被页面 CSP 限制）。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "KAI_ASK") return false;
  askOnce(msg)
    .then((answer) => sendResponse({ ok: true, answer }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true; // async sendResponse
});

async function askOnce({ query, endpoint, apiKey, kbId }) {
  const res = await fetch(endpoint.replace(/\/+$/, "") + "/api/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ kbId, query }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || "HTTP " + res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let answer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === "token") answer += ev.text || "";
      if (ev.type === "error") throw new Error(ev.message || "问答失败");
    }
  }
  return answer;
}
