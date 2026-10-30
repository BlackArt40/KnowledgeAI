<script setup lang="ts">
// 引用来源面板（V4，复刻 src/components/app/chat/sources-panel.tsx）：
// 桌面 xl 侧栏与移动端抽屉共用。web 来源（url）展示可点击外链（🌐 + 域名），
// 本地来源展示块序与相似度。
import { useTranslation } from "i18next-vue";
import { Search, Document, Link } from "@element-plus/icons-vue";
import type { Citation } from "@/api/chat";

defineProps<{ citations: Citation[]; highlightN: number | null }>();
const emit = defineEmits<{ (e: "cite", n: number): void }>();
const { t } = useTranslation();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
</script>

<template>
  <div class="sources">
    <div class="head">
      <el-icon
        :size="14"
        class="mark"
      >
        <Search />
      </el-icon>
      <span class="title">{{ t("page.chat.s5") }}</span>
      <span class="count">{{ citations.length }}</span>
    </div>
    <div class="list kai-scroll">
      <p
        v-if="citations.length === 0"
        class="empty"
      >
        {{ t("page.chat.s80") }}
      </p>
      <button
        v-for="c in citations"
        :key="c.n"
        type="button"
        class="cite"
        :class="{ active: highlightN === c.n }"
        @click="emit('cite', c.n)"
      >
        <div class="cite-head">
          <span class="n">{{ c.n }}</span>
          <el-icon
            v-if="c.url"
            :size="12"
            class="web"
          >
            <Link />
          </el-icon>
          <el-icon
            v-else
            :size="12"
            class="doc"
          >
            <Document />
          </el-icon>
          <a
            v-if="c.url"
            :href="c.url"
            target="_blank"
            rel="noopener noreferrer"
            class="name link"
            :title="c.url"
            @click.stop
          >{{ c.docName }}</a>
          <span
            v-else
            class="name"
          >{{ c.docName }}</span>
        </div>
        <p class="snippet">
          {{ c.snippet }}
        </p>
        <div class="meta">
          <span class="src">{{ c.url ? `🌐 ${hostOf(c.url)}` : t("page.chat.s67", { idx: c.chunkIndex + 1 }) }}</span>
          <span class="score">{{ t("page.chat.s81", { pct: (c.score * 100).toFixed(0) }) }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sources {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.head {
  display: flex;
  height: 52px;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid hsl(var(--border));
}
.mark {
  color: hsl(var(--primary));
}
.title {
  font-size: 14px;
  font-weight: 600;
}
.count {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: hsl(var(--muted));
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.list {
  flex: 1;
  display: grid;
  gap: 10px;
  align-content: start;
  overflow-y: auto;
  padding: 12px;
}
.empty { font-size: 12px; }

.cite {
  width: 100%;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s;
}
.cite:hover {
  border-color: hsl(var(--primary) / 0.4);
}
.cite.active {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.3);
}
.cite-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.n {
  display: flex;
  height: 20px;
  min-width: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.15);
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--primary));
}
.web {
  flex-shrink: 0;
  color: hsl(var(--tint-sky));
}
.doc {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.name.link {
  color: hsl(var(--primary));
  text-decoration: none;
}
.name.link:hover {
  text-decoration: underline;
}
.snippet {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
}
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.src,
.score {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
.src {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.score {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
</style>
