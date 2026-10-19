<script setup lang="ts">
// 根组件：(app) 组路由（meta.shell）由 AppShell 包裹（导航/通知/Cmd+K），
// 其余（认证/静态/分享/首页）直接渲染。EP 组件文案 locale 暂固定 zh-CN。
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { useRoute } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const theme = useThemeStore();
// 品牌色默认 indigo + system 模式跟随 OS 变化（共享主题引擎）。
theme.init();
</script>

<template>
  <el-config-provider :locale="zhCn">
    <AppShell v-if="route.meta.shell">
      <router-view />
    </AppShell>
    <router-view v-else />
  </el-config-provider>
</template>
