<script setup lang="ts">
// 404 兜底：V0 起前端全部路由都有归宿；网关切流后未迁移路径仍由 Next 兜底，
// 这里只覆盖 Vue 已接管的未知路径。
</script>

<template>
  <main class="nf">
    <h1>404</h1>
    <p>Page not found.</p>
    <router-link to="/">
      KnowledgeAI
    </router-link>
  </main>
</template>

<style scoped>
.nf {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
h1 {
  margin: 0;
  font-size: 48px;
}
a {
  color: hsl(var(--primary));
}
</style>
