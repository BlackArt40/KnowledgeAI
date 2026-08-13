/*!
 * KnowledgeAI Embeddable Widget (P7-2)
 * ---------------------------------------------------------------------------
 * Self-contained chat widget that can be dropped into ANY website:
 *
 *   <script src="https://your-host/widget/kai-widget.js"></script>
 *   <script>
 *     KnowledgeAIWidget.init({
 *       endpoint: "https://your-host",      // KnowledgeAI server origin
 *       apiKey:   "kai_sk_...",             // API key with chat:read scope
 *       kbId:     "kb_xxx",                 // knowledge base to query
 *       title:    "AI 助手",                // panel title (default)
 *       theme:    "light" | "dark" | "auto" // default auto
 *     });
 *   </script>
 *
 * Zero dependencies, no build step, no module system - it injects its own
 * DOM + CSS and talks to the v1 SSE chat API. Works standalone on any static
 * host (this file is the whole widget; demo.html shows usage).
 *
 * The endpoint must allow the page origin (CORS) - see the docs. The widget
 * authenticates with its own API key, so it is rate-limited independently
 * (apikey tier) from any logged-in users.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  "use strict";

  var NS = "kaiw";
  var state = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function css() {
    return (
      "." + NS + "-fab{position:fixed;z-index:2147483000;bottom:24px;right:24px;" +
      "width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;" +
      "transition:transform .2s ease;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6)}" +
      "." + NS + "-fab:hover{transform:scale(1.06)}" +
      "." + NS + "-panel{position:fixed;z-index:2147483001;bottom:92px;right:24px;width:380px;max-width:calc(100vw - 32px);" +
      "height:560px;max-height:calc(100vh - 130px);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;" +
      "background:#fff;color:#1f2937;box-shadow:0 12px 40px rgba(0,0,0,.28);" +
      "border:1px solid rgba(0,0,0,.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;" +
      "opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .18s ease}" +
      "." + NS + "-panel." + NS + "-open{opacity:1;transform:none;pointer-events:auto}" +
      "." + NS + "-head{display:flex;align-items:center;gap:8px;padding:12px 16px;" +
      "background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:600;font-size:15px}" +
      "." + NS + "-head button{margin-left:auto;background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:2px 6px}" +
      "." + NS + "-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;background:#f9fafb}" +
      "." + NS + "-msg{max-width:82%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word}" +
      "." + NS + "-user{align-self:flex-end;background:#6366f1;color:#fff;border-bottom-right-radius:4px}" +
      "." + NS + "-bot{align-self:flex-start;background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-bottom-left-radius:4px}" +
      "." + NS + "-cursor{display:inline-block;width:7px;height:15px;background:#6366f1;vertical-align:-2px;margin-left:2px;animation:" + NS + "-blink 1s steps(2) infinite}" +
      "." + NS + "-input{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e5e7eb;background:#fff}" +
      "." + NS + "-input textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:8px 10px;font-size:14px;font-family:inherit;outline:none;max-height:96px}" +
      "." + NS + "-input textarea:focus{border-color:#6366f1}" +
      "." + NS + "-send{border:0;border-radius:10px;background:#6366f1;color:#fff;padding:0 14px;cursor:pointer;font-size:14px}" +
      "." + NS + "-send:disabled{opacity:.5;cursor:default}" +
      "." + NS + "-hint{font-size:12px;color:#6b7280;padding:0 12px 8px}" +
      "@keyframes " + NS + "-blink{50%{opacity:0}}" +
      "@media (prefers-color-scheme:dark){}" +
      "." + NS + "-dark ." + NS + "-panel{background:#111827;color:#f9fafb;border-color:rgba(255,255,255,.12)}" +
      "." + NS + "-dark ." + NS + "-msgs{background:#0f172a}" +
      "." + NS + "-dark ." + NS + "-bot{background:#1f2937;color:#f3f4f6;border-color:#374151}" +
      "." + NS + "-dark ." + NS + "-input{background:#111827;border-color:#374151}" +
      "." + NS + "-dark ." + NS + "-input textarea{background:#1f2937;color:#f9fafb;border-color:#374151}" +
      "." + NS + "-dark ." + NS + "-hint{color:#9ca3af}"
    );
  }

  function applyTheme() {
    if (!state) return;
    var dark = state.theme === "dark" ||
      (state.theme !== "light" && global.matchMedia &&
        global.matchMedia("(prefers-color-scheme: dark)").matches);
    state.panel.classList.toggle(NS + "-dark", dark);
  }

  function openPanel() {
    state.panel.classList.add(NS + "-open");
    state.fab.style.display = "none";
    state.input.focus();
  }
  function closePanel() {
    state.panel.classList.remove(NS + "-open");
    state.fab.style.display = "flex";
  }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = NS + "-msg " + (role === "user" ? NS + "-user" : NS + "-bot");
    el.textContent = text;
    state.msgs.appendChild(el);
    state.msgs.scrollTop = state.msgs.scrollHeight;
    return el;
  }

  function send() {
    if (state.busy) return;
    var q = state.input.value.trim();
    if (!q) return;
    state.input.value = "";
    state.busy = true;
    state.sendBtn.disabled = true;
    addMsg("user", q);

    var botEl = document.createElement("div");
    botEl.className = NS + "-msg " + NS + "-bot";
    var cursor = document.createElement("span");
    cursor.className = NS + "-cursor";
    botEl.appendChild(cursor);
    state.msgs.appendChild(botEl);
    state.msgs.scrollTop = state.msgs.scrollHeight;

    fetch(state.endpoint + "/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.apiKey },
      body: JSON.stringify({ kbId: state.kbId, query: q }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (d) { throw new Error(d.error || ("HTTP " + res.status)); });
        }
        return res.body.getReader();
      })
      .then(function (reader) {
        var decoder = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += decoder.decode(r.value, { stream: true });
            var idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              var frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              var line = frame.split("\n").find(function (l) { return l.indexOf("data:") === 0; });
              if (!line) continue;
              var ev;
              try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
              if (ev.type === "token") {
                if (botEl.firstChild === cursor) botEl.removeChild(cursor);
                botEl.textContent += ev.text || "";
                state.msgs.scrollTop = state.msgs.scrollHeight;
              } else if (ev.type === "error") {
                throw new Error(ev.message || "问答失败");
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        if (botEl.firstChild === cursor) botEl.removeChild(cursor);
        botEl.textContent = "出错了：" + err.message;
      })
      .finally(function () {
        state.busy = false;
        state.sendBtn.disabled = false;
      });
  }

  function build() {
    var style = document.createElement("style");
    style.textContent = css();
    document.head.appendChild(style);

    state.fab = document.createElement("button");
    state.fab.className = NS + "-fab";
    state.fab.setAttribute("aria-label", "打开 AI 助手");
    state.fab.innerHTML = "<svg width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/></svg>";

    state.panel = document.createElement("div");
    state.panel.className = NS + "-panel";

    var head = document.createElement("div");
    head.className = NS + "-head";
    head.textContent = state.title || "AI 助手";
    var closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "\u00d7";
    closeBtn.onclick = closePanel;
    head.appendChild(closeBtn);

    state.msgs = document.createElement("div");
    state.msgs.className = NS + "-msgs";

    state.input = document.createElement("textarea");
    state.input.rows = 1;
    state.input.placeholder = "输入问题，Enter 发送";
    state.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    state.sendBtn = document.createElement("button");
    state.sendBtn.className = NS + "-send";
    state.sendBtn.textContent = "发送";
    state.sendBtn.onclick = send;

    var inputRow = document.createElement("div");
    inputRow.className = NS + "-input";
    inputRow.appendChild(state.input);
    inputRow.appendChild(state.sendBtn);

    var hint = document.createElement("div");
    hint.className = NS + "-hint";
    hint.textContent = "由 KnowledgeAI 驱动 · 独立部署版";

    state.panel.appendChild(head);
    state.panel.appendChild(state.msgs);
    state.panel.appendChild(hint);
    state.panel.appendChild(inputRow);

    state.fab.onclick = openPanel;

    document.body.appendChild(state.fab);
    document.body.appendChild(state.panel);
    applyTheme();
    if (global.matchMedia) {
      global.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
    }
  }

  /** Public API. */
  global.KnowledgeAIWidget = {
    /**
     * @param {object} opts
     * @param {string} opts.endpoint - server origin (no trailing slash)
     * @param {string} opts.apiKey   - API key with chat:read scope
     * @param {string} opts.kbId     - knowledge base id
     * @param {string} [opts.title]  - panel title
     * @param {string} [opts.theme]  - "light" | "dark" | "auto"
     */
    init: function (opts) {
      if (!opts || !opts.endpoint || !opts.apiKey || !opts.kbId) {
        throw new Error("KnowledgeAIWidget.init requires { endpoint, apiKey, kbId }");
      }
      if (state) return; // idempotent
      state = {
        endpoint: String(opts.endpoint).replace(/\/+$/, ""),
        apiKey: opts.apiKey,
        kbId: opts.kbId,
        title: opts.title || "AI 助手",
        theme: opts.theme || "auto",
        busy: false,
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", build);
      } else {
        build();
      }
    },
    destroy: function () {
      if (!state) return;
      state.fab.remove();
      state.panel.remove();
      state = null;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
