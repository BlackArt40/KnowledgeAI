<script setup lang="ts">
// 全局搜索（P5-2，Cmd+K）：单请求五类实体 + tab 过滤 + 250ms 防抖 + 键盘
// 导航（↑↓/Enter/Esc）+ 最近搜索（kai-recent-search，最多 8 条去重）。
// 深链接契约与 Next 版逐字一致（未迁移路由整页跳转）。
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Search } from "@element-plus/icons-vue";
import {
  loadRecentSearches, saveRecentSearches, search,
  type SearchResults, type TabKey,
} from "@/api/search";

interface FlatItem {
  id: string;
  type: "kb" | "doc" | "conv" | "task" | "setting";
  title: string;
  subtitle: string;
  href: string;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const { t } = useTranslation();
const router = useRouter();

const query = ref("");
const results = ref<SearchResults | null>(null);
const loading = ref(false);
const tab = ref<TabKey>("all");
const activeIdx = ref(0);
const recent = ref<string[]>([]);
let abortCtrl: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const tabItems = computed(() => [
  { key: "all" as TabKey, label: t("page.global-search.s2") },
  { key: "kbs" as TabKey, label: t("page.global-search.s3") },
  { key: "docs" as TabKey, label: t("page.global-search.s4") },
  { key: "conversations" as TabKey, label: t("page.global-search.s5") },
  { key: "tasks" as TabKey, label: "Agent" },
  { key: "settings" as TabKey, label: t("page.global-search.s6") },
]);

const TYPE_TO_TAB: Record<FlatItem["type"], TabKey> = {
  kb: "kbs", doc: "docs", conv: "conversations", task: "tasks", setting: "settings",
};

function taskStatusLabel(status: string): string {
  return {
    queued: t("page.global-search.s7"), running: t("page.global-search.s8"),
    done: t("page.global-search.s9"), failed: t("page.global-search.s10"),
  }[status] ?? status;
}

watch(() => props.open, (open) => {
  if (open) {
    query.value = "";
    results.value = null;
    tab.value = "all";
    activeIdx.value = 0;
    recent.value = loadRecentSearches();
  } else {
    abortCtrl?.abort();
  }
});

watch(query, (q) => {
  const term = q.trim();
  if (!term) {
    results.value = null;
    loading.value = false;
    activeIdx.value = 0;
    return;
  }
  loading.value = true;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    try {
      results.value = await search(term, abortCtrl.signal);
      activeIdx.value = 0;
    } catch {
      /* aborted or network */
    } finally {
      loading.value = false;
    }
  }, 250);
});

const flat = computed<FlatItem[]>(() => {
  if (!results.value) return [];
  const all: FlatItem[] = [
    ...results.value.kbs.map((kb) => ({
      id: kb.id, type: "kb" as const, title: kb.name,
      subtitle: kb.desc || (kb.shared ? t("page.global-search.s11", { name: kb.ownerName }) : t("page.global-search.s12")),
      href: `/knowledge-base/${kb.id}`,
    })),
    ...results.value.docs.map((d) => ({
      id: d.id, type: "doc" as const, title: d.name,
      subtitle: `${d.kbName} · ${d.status === "ready" ? t("page.global-search.s13") : d.status === "failed" ? t("page.global-search.s14") : t("page.global-search.s15")}`,
      href: `/knowledge-base/${d.kbId}`,
    })),
    ...results.value.conversations.map((c) => ({
      id: c.id, type: "conv" as const, title: c.title,
      subtitle: c.shared ? t("page.global-search.s11") : t("page.global-search.s5"),
      href: `/chat?kb=${c.kbId}&conv=${c.id}`,
    })),
    ...results.value.tasks.map((tk) => ({
      id: tk.id, type: "task" as const, title: tk.topic,
      subtitle: (tk.kbName ? `${tk.kbName} · ` : "") + taskStatusLabel(tk.status),
      href: `/agent?task=${tk.id}`,
    })),
    ...results.value.settings.map((s) => ({
      id: s.id, type: "setting" as const, title: s.label,
      subtitle: t("page.global-search.s6"), href: s.href,
    })),
  ];
  return tab.value === "all" ? all : all.filter((i) => TYPE_TO_TAB[i.type] === tab.value);
});

function go(item: FlatItem) {
  close();
  // 已迁移路由（V1-V4 全集）走 router 内跳，其余整页跳回 Next（跨壳纪律）
  const MIGRATED_PREFIXES = [
    "/dashboard", "/settings", "/knowledge-base", "/team", "/api-keys",
    "/chat", "/agent", "/billing", "/usage",
  ];
  if (MIGRATED_PREFIXES.some((p) => item.href.startsWith(p))) {
    void router.push(item.href);
  } else {
    window.location.href = item.href;
  }
  const q = query.value.trim();
  if (q) {
    const next = [q, ...recent.value.filter((p) => p !== q)].slice(0, 8);
    recent.value = next;
    saveRecentSearches(next);
  }
}

function close() {
  emit("update:open", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIdx.value = Math.min(activeIdx.value + 1, flat.value.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx.value = Math.max(activeIdx.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const item = flat.value[activeIdx.value];
    if (item) go(item);
  } else if (e.key === "Escape" && query.value) {
    e.stopPropagation();
    query.value = "";
  }
}

const empty = computed(() => query.value.trim() === "");

function onRecentClick(term: string) {
  query.value = term;
}
</script>

<template>
  <el-dialog
    :model-value="open"
    :show-close="false"
    width="560px"
    class="gs-dialog"
    align-center
    @update:model-value="emit('update:open', $event)"
    @keydown="onKeydown"
  >
    <div class="gs">
      <div class="gs-input-row">
        <el-icon
          :size="16"
          color="hsl(var(--muted-foreground))"
        >
          <Search />
        </el-icon>
        <input
          v-model="query"
          class="gs-input"
          :placeholder="t('page.app-shell.s2')"
          autofocus
          @keydown="onKeydown"
        >
      </div>

      <div
        v-if="!empty"
        class="gs-tabs"
      >
        <button
          v-for="tb in tabItems"
          :key="tb.key"
          type="button"
          class="gs-tab"
          :class="{ active: tab === tb.key }"
          @click="tab = tb.key"
        >
          {{ tb.label }}
        </button>
      </div>

      <div class="gs-body kai-scroll">
        <!-- 空态：最近搜索 + 快捷入口 -->
        <template v-if="empty">
          <div
            v-if="recent.length > 0"
            class="gs-section"
          >
            <p class="gs-section-title">
              {{ t("page.global-search.s1") }}
            </p>
            <button
              v-for="r in recent"
              :key="r"
              type="button"
              class="gs-row"
              @click="onRecentClick(r)"
            >
              <span class="gs-row-title">{{ r }}</span>
            </button>
          </div>
          <div class="gs-section">
            <p class="gs-section-title">
              {{ t("page.global-search.s6") }}
            </p>
            <button
              type="button"
              class="gs-row"
              @click="go({ id: 's1', type: 'setting', title: t('page.app-shell.s16'), subtitle: '', href: '/settings?tab=security' })"
            >
              <span class="gs-row-title">{{ t("page.app-shell.s29") }}</span>
              <span class="gs-row-sub">{{ t("page.global-search.s6") }}</span>
            </button>
          </div>
        </template>

        <template v-else>
          <div
            v-if="loading && flat.length === 0"
            class="gs-empty"
          >
            {{ t("page.app-shell.s20") }}…
          </div>
          <div
            v-else-if="flat.length === 0"
            class="gs-empty"
          >
            {{ t("page.global-search.s12") }}
          </div>
          <button
            v-for="(item, i) in flat"
            :key="item.type + item.id"
            type="button"
            class="gs-row"
            :class="{ active: i === activeIdx }"
            @mouseenter="activeIdx = i"
            @click="go(item)"
          >
            <span class="gs-row-main">
              <span class="gs-row-title">{{ item.title }}</span>
              <span class="gs-row-sub">{{ item.subtitle }}</span>
            </span>
          </button>
        </template>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.gs {
  display: grid;
  gap: 0;
  margin: -12px;
}
.gs-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid hsl(var(--border));
}
.gs-input {
  flex: 1;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  font-size: 15px;
  color: hsl(var(--foreground));
}
.gs-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid hsl(var(--border));
  overflow-x: auto;
}
.gs-tab {
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}
.gs-tab.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 600;
}
.gs-body {
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
}
.gs-section {
  padding: 4px 0 8px;
}
.gs-section-title {
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}
.gs-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.gs-row:hover,
.gs-row.active {
  background: hsl(var(--accent));
}
.gs-row-main {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.gs-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
}
.gs-row-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.gs-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
</style>
