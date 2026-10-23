<script setup lang="ts">
// 智能问答（V4，复刻 src/app/(app)/chat/page.tsx）：SSE 流式对话
// （@shared/sse 单源解析，事件 sources/token/done 冻结）、markdown+引用
// chips（@/lib/markdown）、反馈/regenerate（temperature 0.7 + topK+3）、
// 归档/标签/共享、联网搜索、图片附件（≤4 base64）、导出 MD、空态示例问
// （按 KB 文档推导）、追问建议、KB 推荐、深链接 ?kb=&conv=。
// V8 补齐语音输入（STT，@shared/voice/stt 单源复用：麦克风 + 中间转写 +
// 终稿自动发送）；移动端横滑切换会话仍后置。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Delete } from "@element-plus/icons-vue";
import { consumeSseStream } from "@shared/sse";
import { extractLiveCitations } from "@/lib/chat-citations";
import "@/styles/chat-view.css";
import { streamRequest } from "@/api/client";
import { subscribeEvents } from "@/lib/event-stream";
import { useSpeechRecognition } from "@/lib/use-speech";
import { fetchKbs, fetchKbDetail, type KbListItem } from "@/api/kb";
import {
  fetchConversations,
  fetchSharedConversations,
  fetchConversation,
  deleteConversation,
  patchConversation,
  submitFeedback,
  type Citation,
  type ConvLite,
  type SharedConv,
} from "@/api/chat";
import ConversationSidebar from "@/components/chat/ConversationSidebar.vue";
import SourcesPanel from "@/components/chat/SourcesPanel.vue";
import ChatHeader from "@/components/chat/ChatHeader.vue";
import ChatEmptyState from "@/components/chat/ChatEmptyState.vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatMessages from "@/components/chat/ChatMessages.vue";
import ChatTagDialog from "@/components/chat/ChatTagDialog.vue";
import type { ChatMsg, ChatRecommendation } from "@/lib/chat-types";

interface ChatKb extends KbListItem {
  settings?: { topK: number };
}
type TFunc = (k: string, vars?: Record<string, string | number>) => string;

// ── 示例问题推导（照抄 Next chat 页 docTopic/kbSuggestions）─────────────
const STOPWORDS = new Set([
  "docs", "documentation", "overview", "home", "index", "readme",
  "api", "app", "platform", "ai", "python", "zh", "en", "www",
]);
const ERROR_TITLE = /(unavailable|redirect|not found|forbidden|denied|error|403|404|access|unavailable in region)/i;

function brandFromHost(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  const brand = parts.find((p) => p.length > 2 && !STOPWORDS.has(p.toLowerCase()));
  return brand || (parts.length >= 2 ? parts[parts.length - 2] : parts[0]);
}

function docTopic(doc: { name: string; type: string; url?: string }): string {
  if (doc.type === "web" && doc.url) {
    const brand = (() => {
      try {
        return brandFromHost(new URL(doc.url).hostname);
      } catch {
        return "";
      }
    })();
    const name = doc.name?.trim();
    if (name && !/^https?:\/\//i.test(name) && !ERROR_TITLE.test(name)) {
      const part = name.split(/[|｜\-–·]/).map((x) => x.trim()).find(Boolean) ?? name;
      const cleaned = part
        .replace(/\b(documentation|docs|overview|official|guide|tutorial)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) return cleaned;
    }
    return brand || name || doc.url;
  }
  return (
    doc.name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]?v?\d+(\.\d+)*$/i, "")
      .replace(/[_\-]+/g, " ")
      .trim() || doc.name
  );
}

const SUGGESTION_TEMPLATES = [
  (t: TFunc, x: string) => t("page.chat.s50", { topic: x }),
  (t: TFunc, x: string) => t("page.chat.s51", { topic: x }),
  (t: TFunc, x: string) => t("page.chat.s52", { topic: x }),
  (t: TFunc, x: string) => t("page.chat.s53", { topic: x }),
];

function kbSuggestions(
  docs: { name: string; type: string; url?: string; status: string }[],
  kbName: string,
  t: TFunc
): string[] {
  const ready = docs.filter((d) => d.status === "ready");
  if (ready.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let i = 0;
  for (const d of ready) {
    if (out.length >= 4) break;
    const topic = docTopic(d);
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    out.push(SUGGESTION_TEMPLATES[i % SUGGESTION_TEMPLATES.length](t, topic));
    i++;
  }
  if (out.length === 0) out.push(t("page.chat.s54", { name: kbName }));
  return out;
}

// ── 状态 ────────────────────────────────────────────────────────────────
const { t, i18next } = useTranslation();
const route = useRoute();

const kbs = ref<ChatKb[]>([]);
const selectedKb = ref("");
const conversations = ref<ConvLite[]>([]);
const sharedConvs = ref<SharedConv[]>([]);
const archivedView = ref(false);
const activeConv = ref<string | null>(null);
const messages = ref<ChatMsg[]>([]);
const input = ref("");
const sending = ref(false);
const attachments = ref<{ mime: string; data: string; name: string }[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const webSearch = ref(false);
const highlightN = ref<number | null>(null);
const confirmDeleteId = ref<string | null>(null);
const convDrawer = ref(false);
const sourcesDrawer = ref(false);
const recommendations = ref<ChatRecommendation[]>([]);
const suggestions = ref<string[]>([]);
const scrollRef = ref<HTMLDivElement | null>(null);
const composerRef = ref<{ focus: () => void } | null>(null);
const abortRef = ref<AbortController | null>(null);
const sendEpoch = ref(0);
const pendingConv = ref<string | null>(null);
// 标签编辑（el-dialog 内联 TagEditor）
const tagTarget = ref<{ id: string; title: string; tags: string[] } | null>(null);
const tagOpen = computed(() => tagTarget.value !== null);

const selectedKbObj = computed(() => kbs.value.find((k) => k.id === selectedKb.value));
const activeIsShared = computed(
  () => activeConv.value !== null && sharedConvs.value.some((c) => c.id === activeConv.value)
);
const activeIsMine = computed(
  () => activeConv.value !== null && conversations.value.some((c) => c.id === activeConv.value)
);
const activeCitations = computed(
  () =>
    [...messages.value]
      .reverse()
      .find((m) => m.role === "assistant" && m.citations && m.citations.length > 0)?.citations ?? []
);
const lastFollowUps = computed(() => {
  const last = messages.value[messages.value.length - 1];
  return last && last.role === "assistant" && !last.streaming && last.followUps?.length ? last.followUps : [];
});

// ── 加载流 ──────────────────────────────────────────────────────────────
async function refreshKbs(kbParam: string) {
  try {
    kbs.value = (await fetchKbs()) as ChatKb[];
    if (kbs.value.length > 0 && !selectedKb.value) {
      const fromUrl = kbParam ? kbs.value.find((k) => k.id === kbParam) : null;
      selectedKb.value = fromUrl ? fromUrl.id : kbs.value[0].id;
    }
  } catch {
    /* offline: keep view */
  }
}

async function refreshShared() {
  try {
    sharedConvs.value = await fetchSharedConversations();
  } catch {
    sharedConvs.value = [];
  }
}

function refreshConversations() {
  if (!selectedKb.value) return Promise.resolve();
  return fetchConversations(selectedKb.value, archivedView.value)
    .then((cs) => (conversations.value = cs))
    .catch(() => {});
}

async function loadSuggestions(kbId: string) {
  if (!kbId) {
    suggestions.value = [];
    return;
  }
  try {
    const d = await fetchKbDetail(kbId);
    suggestions.value = kbSuggestions(d.docs ?? [], d.kb?.name ?? "", t);
  } catch {
    suggestions.value = [];
  }
}

onMounted(() => {
  const kbParam = typeof route.query.kb === "string" ? route.query.kb : "";
  const convParam = typeof route.query.conv === "string" ? route.query.conv : "";
  if (convParam) pendingConv.value = convParam;
  void refreshKbs(kbParam);
  void refreshShared();
});

watch(selectedKb, (kb) => {
  if (!kb) return;
  activeConv.value = null;
  messages.value = [];
  void refreshConversations().then(() => {
    // 深链接 ?conv=：会话列表就绪后加载目标会话
    if (pendingConv.value) {
      const id = pendingConv.value;
      pendingConv.value = null;
      void loadConversation(id);
    }
  });
  void loadSuggestions(kb);
});

watch(archivedView, () => {
  activeConv.value = null;
  messages.value = [];
  void refreshConversations();
});

watch(messages, () => {
  void nextTick(() => scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: "smooth" }));
});

// 切走页面时终止在途 SSE，避免继续写已卸载组件的状态并消耗 LLM 配额。
onBeforeUnmount(() => {
  abortRef.value?.abort();
  abortRef.value = null;
});

// ── 共享会话实时消息（P4-1，/api/chat/conversations/[id]/events）──────────
// 只有「已共享」的会话可订阅（服务端对未共享会话返回 403，属于确定性失败，
// subscribeEvents 会直接停止而不会重连）。
let convEvents: { stop: () => void } | null = null;

function onSharedMessage(event: Record<string, unknown>) {
  if (event.type !== "message") return;
  const m = event.message as
    | { id?: string; role?: "user" | "assistant"; content?: string; citations?: Citation[] }
    | undefined;
  if (!m?.id) return;
  if (messages.value.some((x) => x.serverId === m.id || x.id === m.id)) return;
  // 自己那股流的回声：本地已有条目，只补 serverId，不重复入列
  if (m.role === "assistant" && sending.value) {
    const streaming = messages.value.find((x) => x.streaming);
    if (streaming) {
      streaming.serverId = m.id;
      return;
    }
  }
  const echo = messages.value.find((x) => !x.serverId && x.role === m.role && x.content === m.content);
  if (echo) {
    echo.serverId = m.id;
    return;
  }
  messages.value = [
    ...messages.value,
    {
      id: m.id,
      serverId: m.id,
      role: m.role ?? "user",
      content: m.content ?? "",
      citations: m.citations,
      streaming: false,
    },
  ];
}

function subscribeSharedConv() {
  convEvents?.stop();
  convEvents = null;
  const id = activeConv.value;
  if (!id || !activeIsShared.value) return;
  convEvents = subscribeEvents(`/api/chat/conversations/${encodeURIComponent(id)}/events`, {
    onEvent: onSharedMessage,
    reconnectMs: 5000,
  });
}

watch([activeConv, activeIsShared], subscribeSharedConv);

onBeforeUnmount(() => {
  convEvents?.stop();
  convEvents = null;
});

// ── 会话操作 ────────────────────────────────────────────────────────────
function abortStream(): boolean {
  if (!abortRef.value) return false;
  abortRef.value.abort();
  abortRef.value = null;
  sending.value = false;
  return true;
}

async function loadConversation(id: string) {
  if (abortStream()) refreshConversations();
  activeConv.value = id;
  convDrawer.value = false;
  highlightN.value = null;
  try {
    const history = await fetchConversation(id);
    messages.value = history.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      citations: m.citations,
      feedback: m.feedback,
      feedbackNote: m.feedbackNote,
      followUps: m.followUps,
      streaming: false,
      // 历史消息自带服务端 id
      serverId: m.id,
    }));
  } catch {
    /* ignore */
  }
}

function newChat() {
  if (abortStream()) refreshConversations();
  activeConv.value = null;
  messages.value = [];
  input.value = "";
  highlightN.value = null;
  composerRef.value?.focus();
}

async function removeConversation(id: string) {
  conversations.value = conversations.value.filter((c) => c.id !== id);
  if (activeConv.value === id) {
    activeConv.value = null;
    messages.value = [];
  }
  try {
    await deleteConversation(id);
  } catch {
    /* ignore */
  }
}

async function setArchive(id: string, archived: boolean) {
  try {
    await patchConversation(id, { archived });
  } catch {
    /* ignore */
  }
  refreshConversations();
  if (activeConv.value === id && archived) {
    activeConv.value = null;
    messages.value = [];
  }
}

function openTags(id: string) {
  const c = conversations.value.find((x) => x.id === id);
  tagTarget.value = { id, title: c?.title ?? t("page.chat.s16"), tags: c?.tags ?? [] };
}

async function saveTags(tags: string[]) {
  if (!tagTarget.value) return;
  try {
    await patchConversation(tagTarget.value.id, { tags });
  } catch {
    /* ignore */
  }
  tagTarget.value = null;
  refreshConversations();
}

async function toggleShare() {
  if (!activeConv.value) return;
  try {
    await patchConversation(activeConv.value, { shared: !activeIsShared.value });
  } catch {
    /* ignore */
  }
  refreshConversations();
  void refreshShared();
}

async function loadRecommendations(query: string) {
  if (!selectedKb.value) return;
  try {
    const d = (await fetch(
      `/api/knowledge-base/recommend?q=${encodeURIComponent(query)}&excludeKbId=${selectedKb.value}`
    ).then((r) => r.json())) as { recommendations?: { id: string; name: string; desc: string; matched: string[] }[] } | null;
    recommendations.value = d?.recommendations ?? [];
  } catch {
    recommendations.value = [];
  }
}

// ── SSE 流式问答 ────────────────────────────────────────────────────────

async function streamAnswer(
  content: string,
  aiMsgId: string,
  epoch: number,
  opts?: { regenerate?: boolean; images?: { mime: string; data: string }[] }
) {
  const controller = new AbortController();
  abortRef.value = controller;
  let acc = "";
  let sourceChunks: { docId: string; docName: string; chunkIndex: number; snippet: string; score: number; url?: string; sourceType?: string }[] = [];
  try {
    const res = await streamRequest(
      "/api/chat",
      {
        kbId: selectedKb.value,
        query: content,
        conversationId: activeConv.value ?? undefined,
        webSearch: webSearch.value,
        ...(opts?.images && opts.images.length > 0 ? { images: opts.images } : {}),
        // regenerate 换参重试（高温 + 更宽检索），服务端同步替换旧答案
        ...(opts?.regenerate
          ? { regenerate: true, temperature: 0.7, topK: (selectedKbObj.value?.settings?.topK ?? 5) + 3 }
          : {}),
      },
      controller.signal
    );
    if (!res.ok || !res.body) throw new Error(t("page.chat.s12"));

    let convId = activeConv.value;
    await consumeSseStream(res, (data) => {
      const d = data as {
        type: string;
        text?: string;
        chunks?: typeof sourceChunks;
        conversationId?: string;
        citations?: Citation[];
        followUps?: string[];
        messageId?: string;
        message?: string;
      };
      if (d.type === "sources") {
        sourceChunks = d.chunks ?? [];
      } else if (d.type === "token") {
        acc += d.text ?? "";
        const liveCites = extractLiveCitations(acc, sourceChunks);
        messages.value = messages.value.map((x) =>
          x.id === aiMsgId ? { ...x, content: acc, citations: liveCites.length > 0 ? liveCites : x.citations } : x
        );
      } else if (d.type === "done") {
        convId = d.conversationId ?? convId;
        messages.value = messages.value.map((x) =>
          x.id === aiMsgId
            ? {
                ...x,
                content: acc,
                citations: d.citations,
                followUps: d.followUps,
                streaming: false,
                ...(d.messageId ? { serverId: d.messageId } : {}),
              }
            : x
        );
      } else if (d.type === "error") {
        acc = acc || d.message || t("page.chat.s13");
        messages.value = messages.value.map((x) => (x.id === aiMsgId ? { ...x, content: acc, streaming: false } : x));
      }
    });
    // 中途未切走的才切到新会话并刷新侧栏（epoch 守卫）
    if (convId !== activeConv.value && sendEpoch.value === epoch) {
      activeConv.value = convId;
      refreshConversations();
    } else if (sendEpoch.value === epoch) {
      refreshConversations();
    }
  } catch (err) {
    // 用户主动停止：保留已流出的部分内容，不按错误处理
    const aborted = err instanceof DOMException && err.name === "AbortError";
    if (!aborted) {
      messages.value = messages.value.map((x) =>
        x.id === aiMsgId ? { ...x, content: acc || t("page.chat.s13"), streaming: false } : x
      );
    }
  } finally {
    abortRef.value = null;
  }
}

function stopGeneration() {
  abortStream();
  messages.value = messages.value.map((x) => (x.streaming ? { ...x, streaming: false } : x));
}

// V8：语音输入（STT）——中间转写实时上屏，终稿自动发送（P7-4 同语义）。
// 不支持 Web Speech API 的浏览器（headless）supported=false，按钮隐藏。
const {
  listening: sttListening,
  interim: sttInterim,
  supported: sttSupported,
  start: sttStart,
  stop: sttStop,
} = useSpeechRecognition({
  onFinalText: (text) => void send(text),
  onError: () => {},
});

async function send(text?: string) {
  const content = (text ?? input.value).trim();
  if (!content || !selectedKb.value || sending.value) return;
  const withImages = attachments.value.length > 0 ? attachments.value.map(({ mime, data }) => ({ mime, data })) : undefined;
  input.value = "";
  attachments.value = [];
  sending.value = true;
  const userMsg: ChatMsg = { id: `u_${Date.now()}`, role: "user", content };
  const aiMsg: ChatMsg = { id: `a_${Date.now()}`, role: "assistant", content: "", streaming: true };
  messages.value = [...messages.value, userMsg, aiMsg];
  const epoch = ++sendEpoch.value;
  try {
    await streamAnswer(content, aiMsg.id, epoch, { images: withImages });
  } finally {
    if (epoch === sendEpoch.value) sending.value = false;
  }
  void loadRecommendations(content);
}

async function regenerate() {
  if (sending.value || !selectedKb.value) return;
  const lastUser = [...messages.value].reverse().find((m) => m.role === "user");
  if (!lastUser) return;
  const aiId = `a_${Date.now()}`;
  const copy = [...messages.value];
  if (copy[copy.length - 1]?.role === "assistant") copy.pop();
  copy.push({ id: aiId, role: "assistant", content: "", streaming: true });
  messages.value = copy;
  const epoch = ++sendEpoch.value;
  sending.value = true;
  try {
    await streamAnswer(lastUser.content, aiId, epoch, { regenerate: true });
  } finally {
    if (epoch === sendEpoch.value) sending.value = false;
  }
  void loadRecommendations(lastUser.content);
}

async function onFeedback(id: string, v: "up" | "down", note?: string) {
  const msg = messages.value.find((x) => x.id === id);
  if (!msg) return;
  const toggleOff = msg.feedback === v;
  messages.value = messages.value.map((x) =>
    x.id === id
      ? x.feedback === v
        ? { ...x, feedback: undefined, feedbackNote: undefined }
        : { ...x, feedback: v, feedbackNote: note || undefined }
      : x
  );
  const serverId = msg.serverId;
  if (!serverId || !activeConv.value) return;
  try {
    await submitFeedback(activeConv.value, serverId, toggleOff ? null : v, note);
  } catch {
    /* ignore */
  }
}

// ── 附件 / 导出 ─────────────────────────────────────────────────────────
function pickImages(files: FileList | null) {
  if (!files) return;
  const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 4 - attachments.value.length);
  for (const f of list) {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? "").split(",")[1] ?? "";
      if (data) attachments.value = [...attachments.value, { mime: f.type || "image/png", data, name: f.name }];
    };
    reader.readAsDataURL(f);
  }
  if (fileInput.value) fileInput.value.value = "";
}

function removeAttachment(i: number) {
  attachments.value = attachments.value.filter((_, j) => j !== i);
}

function exportConversation() {
  if (!activeConv.value) return;
  const t2 = t as TFunc;
  const lines: string[] = [];
  lines.push(t2("page.chat.s59"));
  lines.push("");
  lines.push(t2("page.chat.s60", { time: new Date().toLocaleString(i18next.language === "en" ? "en-US" : "zh-CN") }));
  lines.push(t2("page.chat.s61", { id: activeConv.value }));
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of messages.value) {
    if (m.role === "user") {
      lines.push(t2("page.chat.s62"));
      lines.push("");
      lines.push(m.content);
      lines.push("");
    } else {
      lines.push(t2("page.chat.s63"));
      lines.push("");
      const cleanText = m.content.replace(/\[(\d+)\]/g, (_, n) => `[[${n}]](#ref-${n})`);
      lines.push(cleanText);
      lines.push("");
      if (m.citations && m.citations.length > 0) {
        lines.push(t2("page.chat.s14"));
        lines.push("");
        for (const c of m.citations) {
          lines.push(t2("page.chat.s66", { n: c.n, doc: c.docName, idx: c.chunkIndex + 1, pct: (c.score * 100).toFixed(0) }));
          lines.push(`  > ${c.snippet.replace(/\n/g, " ")}`);
        }
        lines.push("");
      }
      if (m.followUps && m.followUps.length > 0) {
        lines.push(t2("page.chat.s15"));
        lines.push("");
        for (const f of m.followUps) lines.push(`- ${f}`);
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conversation-${activeConv.value.slice(-8)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function onSendKeydown(e: KeyboardEvent) {
  // IME 组合中的 Enter（确认候选词）不发送
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}
</script>

<template>
  <div class="chat-page">
    <!-- 会话侧栏（桌面） -->
    <aside class="conv-side">
      <ConversationSidebar
        :conversations="conversations"
        :shared-convs="sharedConvs"
        :active-conv="activeConv"
        :archived-view="archivedView"
        @toggle-archived="archivedView = !archivedView"
        @new="newChat"
        @select="loadConversation"
        @remove="confirmDeleteId = $event"
        @archive="setArchive"
        @tags="openTags"
      />
    </aside>
    <!-- 会话抽屉（移动端） -->
    <el-drawer
      v-model="convDrawer"
      direction="ltr"
      size="280px"
      :title="t('page.chat.s0')"
    >
      <ConversationSidebar
        :conversations="conversations"
        :shared-convs="sharedConvs"
        :active-conv="activeConv"
        :archived-view="archivedView"
        @toggle-archived="archivedView = !archivedView"
        @new="newChat(); convDrawer = false"
        @select="loadConversation"
        @remove="confirmDeleteId = $event"
        @archive="setArchive"
        @tags="openTags"
      />
    </el-drawer>

    <!-- 主区 -->
    <section class="chat-main">
      <ChatHeader
        :kbs="kbs"
        :selected-kb="selectedKb"
        :selected-kb-obj="selectedKbObj"
        :active-conv="activeConv"
        :messages-count="messages.length"
        :active-is-mine="activeIsMine"
        :active-is-shared="activeIsShared"
        @change-kb="selectedKb = $event"
        @open-drawer="convDrawer = true"
        @open-sources="sourcesDrawer = true"
        @export="exportConversation"
        @toggle-share="toggleShare"
      />

      <!-- 消息区 -->
      <div
        ref="scrollRef"
        class="msgs"
      >
        <ChatEmptyState
          v-if="messages.length === 0"
          :has-ready="!!(selectedKbObj && selectedKbObj.stats.ready > 0)"
          :suggestions="suggestions"
          @pick="send"
        />
        <ChatMessages
          :messages="messages"
          :last-follow-ups="lastFollowUps"
          :recommendations="recommendations"
          @cite="highlightN = $event"
          @regenerate="regenerate"
          @feedback="(id, v, note) => onFeedback(id, v, note)"
          @pick="send"
          @select-recommendation="selectedKb = $event; recommendations = []"
        />
      </div>

      <!-- 输入区 -->
      <ChatComposer
        ref="composerRef"
        v-model="input"
        :sending="sending"
        :web-search="webSearch"
        :attachments="attachments"
        :stt-supported="sttSupported"
        :stt-listening="sttListening"
        :stt-interim="sttInterim"
        :placeholder="selectedKbObj ? t('page.chat.s55', { extra: webSearch ? t('page.chat.s25') : '' }) : t('page.chat.s56')"
        :send-disabled="!input.trim() || !selectedKb"
        @update:web-search="webSearch = $event"
        @send="send()"
        @stop="stopGeneration"
        @attach="pickImages"
        @remove-attachment="removeAttachment"
        @toggle-stt="sttListening ? sttStop() : sttStart()"
        @keydown="onSendKeydown"
      />
    </section>

    <!-- 引用面板（桌面 xl） -->
    <aside class="sources-side">
      <SourcesPanel
        :citations="activeCitations"
        :highlight-n="highlightN"
        @cite="highlightN = $event"
      />
    </aside>
    <!-- 引用抽屉（移动端） -->
    <el-drawer
      v-model="sourcesDrawer"
      direction="rtl"
      size="300px"
      :title="t('page.chat.s5')"
    >
      <SourcesPanel
        :citations="activeCitations"
        :highlight-n="highlightN"
        @cite="highlightN = $event"
      />
    </el-drawer>

    <!-- 标签编辑 -->
    <ChatTagDialog
      :open="tagOpen"
      :title="tagTarget?.title ?? ''"
      :tags="tagTarget?.tags ?? []"
      @update:open="tagTarget = $event ? tagTarget : null"
      @save="saveTags"
    />

    <!-- 删除会话确认 -->
    <el-dialog
      :model-value="confirmDeleteId !== null"
      :title="t('page.chat.s7')"
      width="380px"
      @close="confirmDeleteId = null"
    >
      <p class="dialog-desc">
        {{ t("page.chat.s76") }}
      </p>
      <template #footer>
        <el-button @click="confirmDeleteId = null">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="danger"
          :icon="Delete"
          @click="confirmDeleteId && removeConversation(confirmDeleteId); confirmDeleteId = null"
        >
          {{ t("common.delete") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
