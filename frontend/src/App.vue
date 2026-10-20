<script setup lang="ts">
// 根组件：(app) 组路由（meta.shell）由 AppShell 包裹（导航/通知/Cmd+K），
// 其余（认证/静态/分享/首页）直接渲染。EP 内置文案（分页/日期/空状态）
// 跟随应用语言动态切换，避免切到 en 后仍显示中文。
import { onBeforeUnmount, ref } from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import { useRoute } from "vue-router";
import { getI18nInstance } from "@shared/i18n/translate";
import AppShell from "@/components/AppShell.vue";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const theme = useThemeStore();
// 品牌色默认 indigo + system 模式跟随 OS 变化（共享主题引擎）。
theme.init();

const i18n = getI18nInstance();
const epLocale = ref(i18n.language?.startsWith("en") ? en : zhCn);
function syncEpLocale() {
  epLocale.value = i18n.language?.startsWith("en") ? en : zhCn;
}
i18n.on("languageChanged", syncEpLocale);
onBeforeUnmount(() => i18n.off("languageChanged", syncEpLocale));
</script>

<template>
  <el-config-provider :locale="epLocale">
    <AppShell v-if="route.meta.shell">
      <router-view />
    </AppShell>
    <router-view v-else />
  </el-config-provider>
</template>
