<script setup lang="ts">
// 智能问答（V4，复刻 src/app/(app)/chat/page.tsx）：SSE 流式对话
// （@shared/sse 单源解析，事件 sources/token/done 冻结）、markdown+引用
// chips（@/lib/markdown）、反馈/regenerate（temperature 0.7 + topK+3）、
// 归档/标签/共享、联网搜索、图片附件（≤4 base64）、导出 MD、空态示例问
// （按 KB 文档推导）、追问建议、KB 推荐、深链接 ?kb=&conv=。
// V8 补齐语音输入（STT，@shared/voice/stt 单源复用：麦克风 + 中间转写 +
// 终稿自动发送）；移动端横滑切换会话仍后置。
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useTranslation } from "i18next-vue";
import {
  ChatDotRound,
  Collection,
  Compass,
  Download,
  Picture,
  Promotion,
  Search,
  Share,
  MagicStick,
  Microphone,
  VideoPause,
  Delete,
} from "@element-plus/icons-vue";
import { consumeSseStream } from "@shared/sse";
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
import MessageBubble from "@/components/chat/MessageBubble.vue";
import SourcesPanel from "@/components/chat/SourcesPanel.vue";

interface ChatKb extends KbListItem {
  settings?: { topK: number };
}
interface Msg {
  id: string;
  /** 服务端消息 id（done 事件写入），反馈 API 以它为准 */
  serverId?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  feedback?: "up" | "down";
  feedbackNote?: string;
  followUps?: string[];
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
const messages = ref<Msg[]>([]);
const input = ref("");
const sending = ref(false);
const attachments = ref<{ mime: string; data: string; name: string }[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const webSearch = ref(false);
const highlightN = ref<number | null>(null);
const confirmDeleteId = ref<string | null>(null);
const convDrawer = ref(false);
const sourcesDrawer = ref(false);
const recommendations = ref<{ id: string; name: string; desc: string; matched: string[] }[]>([]);
const suggestions = ref<string[]>([]);
const scrollRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const abortRef = ref<AbortController | null>(null);
const sendEpoch = ref(0);
const pendingConv = ref<string | null>(null);
// 标签编辑（el-dialog 内联 TagEditor）
const tagTarget = ref<{ id: string; title: string; tags: string[] } | null>(null);
const tagDraft = ref<string[]>([]);
const tagInput = ref("");
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
  return last && last.role === "assistant" && !last.streaming && last.followUps?.length ? last.followUps : null;
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
  inputRef.value?.focus();
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
  tagDraft.value = [...(c?.tags ?? [])];
  tagInput.value = "";
}

function addTag() {
  const tag = tagInput.value.trim().replace(/^#/, "");
  if (tag && !tagDraft.value.includes(tag) && tagDraft.value.length < 10) tagDraft.value = [...tagDraft.value, tag];
  tagInput.value = "";
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTag();
  } else if (e.key === "Backspace" && !tagInput.value && tagDraft.value.length > 0) {
    tagDraft.value = tagDraft.value.slice(0, -1);
  }
}

async function saveTags() {
  if (!tagTarget.value) return;
  try {
    await patchConversation(tagTarget.value.id, { tags: tagDraft.value });
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
function extractLiveCitations(
  text: string,
  sources: { docId: string; docName: string; chunkIndex: number; snippet: string; score: number; url?: string; sourceType?: string }[]
): Citation[] {
  if (sources.length === 0) return [];
  const seen = new Set<number>();
  const citations: Citation[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10);
    if (n < 1 || n > sources.length || seen.has(n)) continue;
    seen.add(n);
    const s = sources[n - 1];
    citations.push({
      n,
      docId: s.docId,
      docName: s.docName,
      chunkIndex: s.chunkIndex,
      snippet: s.snippet,
      score: s.score,
      ...(s.url ? { url: s.url } : {}),
      ...(s.sourceType ? { sourceType: s.sourceType } : {}),
    });
  }
  return citations;
}

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
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kbId: selectedKb.value,
        query: content,
        conversationId: activeConv.value ?? undefined,
        webSearch: webSearch.value,
        ...(opts?.images && opts.images.length > 0 ? { images: opts.images } : {}),
        // regenerate 换参重试（高温 + 更宽检索），服务端同步替换旧答案
        ...(opts?.regenerate
          ? { regenerate: true, temperature: 0.7, topK: (selectedKbObj.value?.settings?.topK ?? 5) + 3 }
          : {}),
      }),
      signal: controller.signal,
    });
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
  const userMsg: Msg = { id: `u_${Date.now()}`, role: "user", content };
  const aiMsg: Msg = { id: `a_${Date.now()}`, role: "assistant", content: "", streaming: true };
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
      <header class="chat-head">
        <button
          type="button"
          class="icon-btn lg-only-hidden"
          :aria-label="t('page.chat.s0')"
          @click="convDrawer = true"
        >
          <el-icon :size="14">
            <ChatDotRound />
          </el-icon>
        </button>
        <span
          v-if="kbs.length === 0"
          class="kb-hint"
        >{{ t("page.chat.s1") }}</span>
        <el-select
          v-else
          v-model="selectedKb"
          class="kb-select"
          size="small"
        >
          <el-option
            v-for="kb in kbs"
            :key="kb.id"
            :value="kb.id"
            :label="kb.name"
          >
            <span class="kb-opt">
              <el-icon
                :size="12"
                class="kb-opt-ico"
              >
                <Collection />
              </el-icon>
              {{ kb.name }} · {{ t("page.chat.s70", { count: kb.stats.ready }) }}{{ kb.shared ? t("page.chat.s57", { name: kb.ownerName ?? "" }) : "" }}
            </span>
          </el-option>
        </el-select>
        <span
          v-if="selectedKbObj"
          class="ready-badge"
        >{{ t("page.chat.s71", { count: selectedKbObj.stats.ready }) }}</span>
        <button
          type="button"
          class="src-btn"
          :aria-label="t('page.chat.s5')"
          @click="sourcesDrawer = true"
        >
          <el-icon :size="12">
            <Search />
          </el-icon>
          <span class="src-btn-text">{{ t("page.chat.s2") }}</span>
        </button>
        <el-button
          v-if="activeConv && messages.length > 0"
          size="small"
          :icon="Download"
          :aria-label="t('page.chat.s18')"
          @click="exportConversation"
        >
          <span class="btn-text">{{ t("page.chat.s3") }}</span>
        </el-button>
        <el-button
          v-if="activeIsMine"
          size="small"
          :icon="Share"
          :class="{ 'share-on': activeIsShared }"
          :aria-label="activeIsShared ? t('page.chat.s19') : t('page.chat.s20')"
          :title="activeIsShared ? t('page.chat.s21') : t('page.chat.s22')"
          @click="toggleShare"
        >
          <span class="btn-text">{{ activeIsShared ? t("page.chat.s23") : t("page.chat.s24") }}</span>
        </el-button>
      </header>

      <!-- 消息区 -->
      <div
        ref="scrollRef"
        class="msgs"
      >
        <div
          v-if="messages.length === 0"
          class="empty-state"
        >
          <span class="empty-ava">
            <el-icon :size="24">
              <MagicStick />
            </el-icon>
          </span>
          <h3>{{ t("page.chat.s8") }}</h3>
          <p>{{ selectedKbObj && selectedKbObj.stats.ready > 0 ? t("page.chat.s33") : t("page.chat.s34") }}</p>
          <div
            v-if="selectedKbObj && selectedKbObj.stats.ready > 0"
            class="sug-list"
          >
            <button
              v-for="s in suggestions"
              :key="s"
              type="button"
              class="sug"
              @click="send(s)"
            >
              {{ s }}
            </button>
          </div>
          <router-link
            v-else
            to="/knowledge-base"
            class="go-kb"
          >
            {{ t("page.chat.s9") }}
          </router-link>
        </div>
        <template
          v-for="(m, i) in messages"
          :key="m.id"
        >
          <MessageBubble
            :msg="m"
            @cite="highlightN = $event"
            @regenerate="regenerate"
            @feedback="(v, note) => onFeedback(m.id, v, note)"
          />
          <div
            v-if="lastFollowUps && i === messages.length - 1"
            class="followups"
          >
            <span class="fu-label">
              <el-icon :size="11">
                <MagicStick />
              </el-icon>
              {{ t("page.chat.s82") }}
            </span>
            <button
              v-for="(s, fi) in lastFollowUps"
              :key="fi"
              type="button"
              class="sug"
              @click="send(s)"
            >
              {{ s }}
            </button>
          </div>
        </template>
        <!-- 相关知识库推荐 -->
        <div
          v-if="messages.length > 0 && recommendations.length > 0"
          class="rec-block"
        >
          <p class="rec-head">
            <el-icon
              :size="12"
              class="rec-ico"
            >
              <MagicStick />
            </el-icon>
            {{ t("page.chat.s72") }}
          </p>
          <button
            v-for="r in recommendations"
            :key="r.id"
            type="button"
            class="rec-item"
            @click="selectedKb = r.id; recommendations = []"
          >
            <el-icon
              :size="13"
              class="rec-ico"
            >
              <Collection />
            </el-icon>
            <span class="rec-main">
              <span class="rec-name">{{ r.name }}</span>
              <span class="rec-desc">{{ r.desc || t("page.chat.s25") }}</span>
            </span>
            <span class="rec-terms">{{ t("page.chat.s73", { terms: r.matched.join(t("page.chat.s77")) }) }}</span>
          </button>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="composer">
        <div class="ws-row">
          <button
            type="button"
            class="ws-toggle"
            :class="{ on: webSearch }"
            :aria-pressed="webSearch"
            :title="webSearch ? t('page.chat.s26') : t('page.chat.s27')"
            @click="webSearch = !webSearch"
          >
            <el-icon :size="12">
              <Compass />
            </el-icon>
            {{ t("page.chat.s74") }}
          </button>
          <span
            v-if="webSearch"
            class="ws-hint"
          >{{ t("page.chat.s4") }}</span>
        </div>
        <div
          v-if="attachments.length > 0"
          class="attach-row"
        >
          <div
            v-for="(img, i) in attachments"
            :key="i"
            class="attach"
          >
            <img
              :src="`data:${img.mime};base64,${img.data}`"
              :alt="img.name"
            >
            <button
              type="button"
              class="attach-x"
              :aria-label="t('page.chat.s64')"
              @click="removeAttachment(i)"
            >
              ×
            </button>
          </div>
        </div>
        <div class="input-box">
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            class="file-hidden"
            @change="pickImages(($event.target as HTMLInputElement).files)"
          >
          <button
            type="button"
            class="icon-btn"
            :aria-label="t('page.chat.s65')"
            :title="t('page.chat.s65')"
            @click="fileInput?.click()"
          >
            <el-icon :size="14">
              <Picture />
            </el-icon>
          </button>
          <!-- V8：语音输入（Web Speech API），不支持的浏览器隐藏 -->
          <button
            v-if="sttSupported"
            type="button"
            class="icon-btn"
            :class="{ listening: sttListening }"
            :aria-label="sttListening ? t('page.chat.s84') : t('page.chat.s83')"
            :title="sttListening ? t('page.chat.s84') : t('page.chat.s83')"
            @click="sttListening ? sttStop() : sttStart()"
          >
            <el-icon :size="14">
              <Microphone />
            </el-icon>
          </button>
          <textarea
            ref="inputRef"
            rows="1"
            class="ask-input"
            :value="sttListening ? (input ? `${input} ${sttInterim}` : sttInterim) : input"
            :placeholder="selectedKbObj ? t('page.chat.s55', { extra: webSearch ? t('page.chat.s25') : '' }) : t('page.chat.s56')"
            @keydown="onSendKeydown"
            @input="input = ($event.target as HTMLTextAreaElement).value"
          />
          <button
            v-if="sending"
            type="button"
            class="send-btn stop"
            :aria-label="t('page.chat.s30')"
            @click="stopGeneration"
          >
            <el-icon :size="14">
              <VideoPause />
            </el-icon>
          </button>
          <button
            v-else
            type="button"
            class="send-btn"
            :disabled="!input.trim() || !selectedKb"
            :aria-label="t('page.chat.s31')"
            @click="send()"
          >
            <el-icon :size="14">
              <Promotion />
            </el-icon>
          </button>
        </div>
      </div>
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
    <el-dialog
      :model-value="tagOpen"
      :title="t('page.chat.s6')"
      width="400px"
      @close="tagTarget = null"
    >
      <p class="dialog-desc">
        {{ t("page.chat.s75", { title: tagTarget?.title ?? "" }) }}
      </p>
      <div class="tag-editor">
        <span
          v-for="tag in tagDraft"
          :key="tag"
          class="tag-chip"
        >
          #{{ tag }}
          <button
            type="button"
            class="tag-x"
            :aria-label="t('page.chat.s58', { tag })"
            @click="tagDraft = tagDraft.filter((x) => x !== tag)"
          >
            ×
          </button>
        </span>
        <input
          v-model="tagInput"
          class="tag-input"
          :placeholder="t('page.chat.s48')"
          @keydown="onTagKeydown"
        >
      </div>
      <template #footer>
        <el-button @click="tagTarget = null">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="primary"
          @click="saveTags"
        >
          {{ t("page.chat.s79") }}
        </el-button>
      </template>
    </el-dialog>

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

<style scoped>
.chat-page {
  display: flex;
  height: calc(100dvh - 8.5rem);
  min-height: 460px;
  gap: 0;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
}
.conv-side {
  display: none;
  width: 256px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.3);
}
@media (min-width: 1024px) {
  .conv-side {
    display: flex;
  }
  .lg-only-hidden {
    display: none !important;
  }
}
.chat-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.chat-head {
  display: flex;
  height: 56px;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid hsl(var(--border));
}
.icon-btn {
  display: inline-flex;
  height: 34px;
  width: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: none;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
}
.icon-btn:hover {
  color: hsl(var(--foreground));
}
/* V8：录音中——destructive 色 + 呼吸脉冲（P7-4 animate-pulse 同语义） */
.icon-btn.listening {
  color: hsl(var(--destructive));
  border-color: hsl(var(--destructive) / 0.4);
  animation: mic-pulse 1.2s ease-in-out infinite;
}
@keyframes mic-pulse {
  50% {
    opacity: 0.5;
  }
}
.kb-hint {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.kb-select {
  min-width: 0;
  max-width: 240px;
  flex: 1;
}
.kb-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.kb-opt-ico {
  color: hsl(var(--primary));
}
.ready-badge {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  font-size: 11px;
  color: hsl(var(--primary));
}
@media (min-width: 768px) {
  .ready-badge {
    display: inline-flex;
  }
}
.src-btn {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 0 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.src-btn:hover {
  color: hsl(var(--foreground));
}
@media (min-width: 1280px) {
  .src-btn {
    display: none;
  }
  .ready-badge {
    margin-left: auto;
  }
  .ready-badge + .src-btn {
    margin-left: 0;
  }
}
@media (max-width: 1279px) {
  .ready-badge + .src-btn {
    margin-left: auto;
  }
}
.btn-text {
  display: none;
}
@media (min-width: 640px) {
  .btn-text {
    display: inline;
  }
}
.share-on {
  border-color: rgb(14 165 233 / 0.4);
  color: #0284c7;
}
.msgs {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
  padding: 16px;
}
@media (min-width: 640px) {
  .msgs {
    padding: 24px;
  }
}
.empty-state {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.empty-ava {
  display: flex;
  height: 56px;
  width: 56px;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  box-shadow: 0 8px 20px hsl(var(--primary) / 0.3);
}
.empty-state h3 {
  margin: 20px 0 0;
  font-size: 17px;
  font-weight: 600;
}
.empty-state p {
  max-width: 24rem;
  margin: 4px 0 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.sug-list {
  display: flex;
  max-width: 32rem;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
}
.sug {
  padding: 6px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--card));
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.sug:hover {
  border-color: hsl(var(--primary) / 0.4);
  color: hsl(var(--foreground));
}
.go-kb {
  margin-top: 24px;
  padding: 8px 16px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  font-size: 13px;
  text-decoration: none;
  color: inherit;
}
.go-kb:hover {
  background: hsl(var(--accent));
}
.followups {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-left: 44px;
}
.fu-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.rec-block {
  margin-left: 4px;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--card) / 0.6);
}
.rec-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.rec-ico {
  color: hsl(var(--primary));
}
.rec-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.rec-item:hover {
  border-color: hsl(var(--primary) / 0.4);
}
.rec-main {
  min-width: 0;
  flex: 1;
}
.rec-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.rec-desc {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.rec-terms {
  flex-shrink: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.composer {
  padding: 12px;
  border-top: 1px solid hsl(var(--border));
}
@media (min-width: 640px) {
  .composer {
    padding: 16px;
  }
}
.ws-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
}
.ws-toggle {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.ws-toggle.on {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.ws-hint {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.attach-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
}
.attach {
  position: relative;
}
.attach img {
  height: 64px;
  width: 64px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  object-fit: cover;
}
.attach-x {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  height: 20px;
  width: 20px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9999px;
  background: hsl(var(--destructive));
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.input-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
}
.input-box:focus-within {
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.35);
}
.file-hidden {
  display: none;
}
.ask-input {
  max-height: 128px;
  min-width: 0;
  flex: 1;
  resize: none;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  font: inherit;
  font-size: 14px;
  color: inherit;
}
.ask-input:focus {
  outline: none;
}
.send-btn {
  display: flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  color: #fff;
  cursor: pointer;
}
.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.send-btn.stop {
  background: hsl(var(--destructive));
}
.sources-side {
  display: none;
  width: 288px;
  flex-shrink: 0;
  border-left: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.3);
}
@media (min-width: 1280px) {
  .sources-side {
    display: block;
  }
}
.dialog-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}
.tag-editor {
  display: flex;
  min-height: 36px;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.tag-x {
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: hsl(var(--primary) / 0.6);
}
.tag-x:hover {
  color: hsl(var(--destructive));
}
.tag-input {
  height: 24px;
  min-width: 96px;
  flex: 1;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
}
.tag-input:focus {
  outline: none;
}
</style>
