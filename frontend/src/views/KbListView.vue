<script setup lang="ts">
// 知识库列表（V3，复刻 src/app/(app)/knowledge-base/page.tsx）：
// 卡片网格（统计/共享标识/owner）、新建对话框（name/desc/color/initial）、
// 删除（owner）、?new=1 深链接自动开新建。
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { Plus } from "@element-plus/icons-vue";
import { createKb, deleteKb, fetchKbs, type KbListItem } from "@/api/kb";
import { ApiError } from "@/api/client";
import { kbAvatarBackground } from "@/lib/kb-color";
import { formatRelative } from "@shared/format";

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();

const kbs = ref<KbListItem[]>([]);
const loading = ref(true);
const createOpen = ref(false);
const creating = ref(false);
const createError = ref<string | null>(null);
const form = ref({ name: "", desc: "", color: "#6366f1", initial: "" });

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#8b5cf6", "#d946ef", "#f43f5e"];

async function refresh() {
  try {
    kbs.value = await fetchKbs();
  } catch {
    /* ignore */
  }
  loading.value = false;
}

onMounted(() => {
  void refresh();
  // 深链接 ?new=1：打开新建对话框并清参（防刷新重复触发）
  if (route.query.new === "1") {
    createOpen.value = true;
    void router.replace({ path: "/knowledge-base" });
  }
});

async function submitCreate() {
  if (!form.value.name.trim()) return;
  creating.value = true;
  createError.value = null;
  try {
    const kb = await createKb({
      name: form.value.name.trim(),
      desc: form.value.desc.trim() || undefined,
      color: form.value.color,
      initial: form.value.initial.trim() || form.value.name.trim().charAt(0).toUpperCase(),
    });
    createOpen.value = false;
    form.value = { name: "", desc: "", color: COLORS[0], initial: "" };
    await router.push(`/knowledge-base/${kb.id}`);
  } catch (e) {
    createError.value = e instanceof ApiError && e.message ? e.message : t("page.settings.s42");
  } finally {
    creating.value = false;
  }
}

async function remove(kb: KbListItem) {
  if (!window.confirm(t("page.kb.s8", { name: kb.name }) )) return;
  try {
    await deleteKb(kb.id);
    await refresh();
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="wrap">
    <div class="head">
      <div>
        <h2>{{ t("page.kb.title") }}</h2>
        <p class="sub">
          {{ t("page.kb.subtitle", { count: kbs.length }) }}
        </p>
      </div>
      <el-button
        type="primary"
        :icon="Plus"
        @click="createOpen = true"
      >
        {{ t("page.kb.newKb") }}
      </el-button>
    </div>

    <div
      v-if="loading"
      class="sk"
      style="height: 200px"
    />
    <div
      v-else-if="kbs.length === 0"
      class="empty"
    >
      <p>{{ t("page.new-kb-dialog.s8") }}</p>
      <el-button
        type="primary"
        plain
        @click="createOpen = true"
      >
        {{ t("page.kb.newKb") }}
      </el-button>
    </div>

    <div
      v-else
      class="grid"
    >
      <div
        v-for="kb in kbs"
        :key="kb.id"
        class="kb-card"
      >
        <router-link
          :to="`/knowledge-base/${kb.id}`"
          class="kb-main"
        >
          <div class="kb-head">
            <span
              class="kb-avatar"
              :style="{ background: kbAvatarBackground(kb.color, kb.name) }"
            >
              {{ kb.initial || kb.name.charAt(0) }}
            </span>
            <span class="kb-name">{{ kb.name }}</span>
            <span
              v-if="kb.shared"
              class="badge shared"
            >{{ t("page.kb.s1", { owner: kb.ownerName }) }}</span>
          </div>
          <p class="kb-desc">
            {{ kb.desc || t("page.kb.noDesc") }}
          </p>
          <div class="kb-stats">
            <span class="stat">{{ kb.stats.total }} {{ t("page.kb.s2", { count: kb.stats.total }) }}</span>
            <span class="stat">{{ kb.stats.chunks }} chunks</span>
            <span
              v-if="kb.stats.processing > 0"
              class="stat processing"
            >
              {{ kb.stats.processing }} {{ t("page.kb.s4") }}
            </span>
          </div>
          <div class="kb-foot">
            <span class="owner">{{ kb.ownerName }}</span>
            <span class="time">{{ formatRelative(kb.updatedAt as number) }}</span>
          </div>
        </router-link>
        <div class="kb-actions">
          <router-link
            :to="`/knowledge-base/${kb.id}/graph`"
            class="graph-link"
          >
            {{ t("page.knowledge-graph.s1") }}
          </router-link>
          <el-button
            v-if="!kb.shared"
            size="small"
            text
            type="danger"
            @click="remove(kb)"
          >
            {{ t("page.kb.deleteKb") }}
          </el-button>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="createOpen"
      :title="t('page.new-kb-dialog.s0')"
      width="440px"
      @closed="createError = null"
    >
      <div class="form">
        <label class="field">
          <span class="label">{{ t("page.new-kb-dialog.s1") }}</span>
          <el-input
            v-model="form.name"
            :placeholder="t('page.new-kb-dialog.s5')"
            required
          />
        </label>
        <label class="field">
          <span class="label">{{ t("page.new-kb-dialog.s2") }}</span>
          <el-input
            v-model="form.desc"
            type="textarea"
            :rows="2"
            :placeholder="t('page.new-kb-dialog.s6')"
          />
        </label>
        <div class="field">
          <span class="label">{{ t("page.new-kb-dialog.s3") }}</span>
          <div class="colors">
            <button
              v-for="c in COLORS"
              :key="c"
              type="button"
              class="color-dot"
              :style="{ background: c }"
              :class="{ active: form.color === c }"
              @click="form.color = c"
            />
          </div>
        </div>
        <p
          v-if="createError"
          class="err"
        >
          {{ createError }}
        </p>
      </div>
      <template #footer>
        <el-button @click="createOpen = false">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="primary"
          :loading="creating"
          @click="submitCreate"
        >
          {{ t("common.create") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  gap: 20px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.kb-card {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  border-radius: var(--radius);
  padding: 16px;
  display: grid;
  gap: 8px;
}
.kb-main {
  text-decoration: none;
  color: inherit;
  display: grid;
  gap: 8px;
}
.kb-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.kb-avatar {
  display: flex;
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}
.kb-name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge.shared {
  margin-left: auto;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.badge { padding: 2px 8px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); flex-shrink: 0; }

.kb-desc {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
}
.kb-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.stat.processing {
  color: hsl(var(--warning));
}
.kb-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}
.kb-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid hsl(var(--border));
  padding-top: 8px;
}
.graph-link {
  font-size: 12px;
  color: hsl(var(--primary));
  text-decoration: none;
}
.empty { display: grid; gap: 12px; justify-items: center; padding: 60px 0; font-size: 14px; }

.form {
  display: grid;
  gap: 14px;
}
.field {
  display: grid;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
}
.colors {
  display: flex;
  gap: 8px;
}
.color-dot {
  height: 26px;
  width: 26px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
}
.color-dot.active {
  border-color: hsl(var(--foreground));
}
.err {
  margin: 0;
  font-size: 13px;
  color: hsl(var(--destructive));
}

</style>
