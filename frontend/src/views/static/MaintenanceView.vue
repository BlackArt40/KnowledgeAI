<script setup lang="ts">
// 维护中页（纯静态，无 API 依赖）。
import { useTranslation } from "i18next-vue";
import { Clock, Message, Setting } from "@element-plus/icons-vue";
import AppLogo from "@/components/AppLogo.vue";

const { t } = useTranslation();
</script>

<template>
  <div class="page">
    <AppLogo />
    <div class="center">
      <div class="badge">
        <el-icon
          :size="40"
          color="hsl(var(--warning))"
        >
          <Setting />
        </el-icon>
      </div>
      <h1>{{ t("page.maintenance.s0") }}</h1>
      <p class="desc">
        {{ t("page.maintenance.s4") }}
      </p>
      <p class="when">
        <el-icon :size="14">
          <Clock />
        </el-icon>
        <span>{{ t("page.maintenance.s1") }}</span>
      </p>
    </div>
    <div class="actions">
      <el-button
        tag="a"
        href="mailto:support@knowledgeai.dev"
      >
        <el-icon><Message /></el-icon> {{ t("page.maintenance.s2") }}
      </el-button>
      <el-button
        tag="a"
        href="/"
      >
        {{ t("page.maintenance.s3") }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0 16px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.center {
  position: relative;
  margin-top: 40px;
  text-align: center;
}
.badge {
  display: flex;
  height: 80px;
  width: 80px;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  border-radius: 16px;
  background: hsl(var(--warning) / 0.1);
}
h1 {
  margin: 24px 0 0;
  font-size: 24px;
  font-weight: 700;
}
.desc {
  max-width: 28rem;
  margin: 8px auto 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.when {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 16px 0 0;
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}
</style>
