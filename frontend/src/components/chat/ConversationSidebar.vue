<script setup lang="ts">
// 会话侧栏（V4，复刻 src/components/app/chat/conversation-list.tsx）：
// 新建/搜索/近期|归档切换/我的+团队共享分组/⋯菜单（归档恢复|标签|删除）。
// 移动端长按手势后置——⋯按钮点击菜单在触屏同样可用。
import { computed, ref } from "vue";
import { useTranslation } from "i18next-vue";
import {
  Plus,
  Search,
  MoreFilled,
  ChatDotRound,
  Share,
  PriceTag,
  Delete,
  FolderRemove,
  FolderOpened,
} from "@element-plus/icons-vue";
import type { ConvLite, SharedConv } from "@/api/chat";

const props = defineProps<{
  conversations: ConvLite[];
  sharedConvs: SharedConv[];
  activeConv: string | null;
  archivedView: boolean;
}>();
const emit = defineEmits<{
  (e: "toggleArchived"): void;
  (e: "new"): void;
  (e: "select", id: string): void;
  (e: "remove", id: string): void;
  (e: "archive", id: string, archived: boolean): void;
  (e: "tags", id: string): void;
}>();
const { t } = useTranslation();

const search = ref("");
const menuFor = ref<string | null>(null);

const filtered = computed(() =>
  props.conversations.filter((c) => c.title.toLowerCase().includes(search.value.trim().toLowerCase()))
);

function toggleMenu(id: string) {
  menuFor.value = menuFor.value === id ? null : id;
}

function menuArchive(c: ConvLite) {
  menuFor.value = null;
  emit("archive", c.id, !c.archived);
}

function menuTags(id: string) {
  menuFor.value = null;
  emit("tags", id);
}

function menuRemove(id: string) {
  menuFor.value = null;
  emit("remove", id);
}
</script>

<template>
  <div class="conv-list">
    <div class="top">
      <el-button
        type="primary"
        class="new-btn"
        :icon="Plus"
        @click="emit('new')"
      >
        {{ t("page.chat.s69") }}
      </el-button>
    </div>
    <div class="filters">
      <div class="search-box">
        <el-icon
          :size="12"
          class="search-ico"
        >
          <Search />
        </el-icon>
        <input
          v-model="search"
          class="search-input"
          :placeholder="t('page.chat.s41')"
          :aria-label="t('page.chat.s41')"
        >
      </div>
      <!-- 近期 / 归档 视图切换 -->
      <div class="view-toggle">
        <button
          type="button"
          class="vt"
          :class="{ on: !archivedView }"
          @click="archivedView && emit('toggleArchived')"
        >
          {{ t("page.chat.s10") }}
        </button>
        <button
          type="button"
          class="vt"
          :class="{ on: archivedView }"
          @click="!archivedView && emit('toggleArchived')"
        >
          {{ t("page.chat.s78") }}
        </button>
      </div>
    </div>
    <div class="items">
      <p
        v-if="filtered.length === 0 && sharedConvs.length === 0"
        class="empty"
      >
        {{
          search ? t("page.chat.s42") : archivedView ? t("page.chat.s43") : t("page.chat.s44")
        }}
      </p>
      <p
        v-if="!archivedView && filtered.length > 0"
        class="group"
      >
        {{ t("page.chat.s10") }}
      </p>
      <div
        v-for="c in filtered"
        :key="c.id"
        class="item-wrap"
      >
        <div
          class="item"
          :class="{ active: activeConv === c.id }"
          @click="emit('select', c.id)"
        >
          <el-icon
            :size="13"
            class="item-ico"
          >
            <ChatDotRound />
          </el-icon>
          <span class="item-main">
            <span class="item-title">{{ c.title }}</span>
            <span
              v-if="c.tags && c.tags.length > 0"
              class="item-tags"
            >
              <span
                v-for="tag in c.tags"
                :key="tag"
                class="tag"
              >#{{ tag }}</span>
            </span>
          </span>
          <button
            type="button"
            class="more"
            :class="{ show: activeConv === c.id || menuFor === c.id }"
            :aria-label="t('page.chat.s45')"
            @click.stop="toggleMenu(c.id)"
          >
            <el-icon :size="13">
              <MoreFilled />
            </el-icon>
          </button>
        </div>
        <!-- ⋯ 菜单：归档/恢复 · 标签 · 删除 -->
        <template v-if="menuFor === c.id">
          <div
            class="menu-overlay"
            @click="menuFor = null"
          />
          <div class="menu">
            <button
              type="button"
              class="menu-item"
              @click.stop="menuArchive(c)"
            >
              <el-icon :size="12">
                <component :is="c.archived ? FolderOpened : FolderRemove" />
              </el-icon>
              {{ c.archived ? t("page.chat.s46") : t("page.chat.s47") }}
            </button>
            <button
              type="button"
              class="menu-item"
              @click.stop="menuTags(c.id)"
            >
              <el-icon :size="12">
                <PriceTag />
              </el-icon>
              {{ t("page.chat.s6") }}
            </button>
            <button
              type="button"
              class="menu-item danger"
              @click.stop="menuRemove(c.id)"
            >
              <el-icon :size="12">
                <Delete />
              </el-icon>
              {{ t("page.chat.s7") }}
            </button>
          </div>
        </template>
      </div>
      <p
        v-if="!archivedView && sharedConvs.length > 0"
        class="group"
      >
        {{ t("page.chat.s11") }}
      </p>
      <div
        v-for="c in archivedView ? [] : sharedConvs"
        :key="c.id"
        class="item-wrap"
      >
        <div
          class="item"
          :class="{ active: activeConv === c.id }"
          @click="emit('select', c.id)"
        >
          <el-icon
            :size="13"
            class="item-ico shared"
          >
            <Share />
          </el-icon>
          <span class="item-main">
            <span class="item-title">{{ c.title }}</span>
          </span>
          <span class="owner">{{ c.ownerName }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conv-list {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.top {
  padding: 12px 12px 0;
}
.new-btn {
  width: 100%;
  justify-content: flex-start;
}
.filters {
  padding: 8px 12px;
}
.search-box {
  position: relative;
}
.search-ico {
  position: absolute;
  top: 50%;
  left: 9px;
  transform: translateY(-50%);
  color: hsl(var(--muted-foreground));
}
.search-input {
  height: 32px;
  width: 100%;
  padding: 0 10px 0 28px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  font: inherit;
  font-size: 12px;
}
.search-input:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.5);
}
.view-toggle {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  padding: 2px;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.7);
}
.vt {
  flex: 1;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}
.vt.on {
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.items {
  flex: 1;
  display: grid;
  gap: 2px;
  align-content: start;
  overflow-y: auto;
  padding: 4px 8px 12px;
}
.empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.group {
  margin: 8px 0 2px;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}
.item-wrap {
  position: relative;
}
.item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
}
.item:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.item-ico {
  flex-shrink: 0;
}
.item-ico.shared {
  color: #0ea5e9;
}
.item-main {
  min-width: 0;
  flex: 1;
}
.item-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
}
.item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.tag {
  padding: 0 6px;
  border-radius: 9999px;
  background: hsl(var(--primary) / 0.1);
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--primary));
}
.owner {
  flex-shrink: 0;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
}
.more {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  opacity: 0.4;
}
.more.show,
.item:hover .more {
  opacity: 1;
}
.more:hover {
  background: hsl(var(--accent));
}
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.menu {
  position: absolute;
  top: 100%;
  right: 8px;
  z-index: 30;
  width: 128px;
  margin-top: 4px;
  padding: 4px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
}
.menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: inherit;
  text-align: left;
}
.menu-item:hover {
  background: hsl(var(--accent));
}
.menu-item.danger {
  color: hsl(var(--destructive));
}
.menu-item.danger:hover {
  background: hsl(var(--destructive) / 0.1);
}
</style>
