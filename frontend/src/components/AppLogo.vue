<script setup lang="ts">
// 品牌字标：与 Next 侧 components/logo.tsx 的双段配色一致（Knowledge 渐变 + AI 前景）。
// 绞杀期链接语义：/ 在网关切到 Vue 前仍是 Next 官网首页，用 <a> 全页跳转。
defineProps<{ light?: boolean }>();
</script>

<template>
  <a
    href="/"
    class="logo"
    :class="{ light }"
  >
    <span class="mark">K</span>
    <span class="word">
      <span class="grad">Knowledge</span><span :class="light ? 'w' : 'fg'">AI</span>
    </span>
  </a>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}
.mark {
  display: flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
}
.word {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.grad {
  background: linear-gradient(135deg, hsl(var(--brand-from)), hsl(var(--brand-to)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.fg {
  color: hsl(var(--foreground));
}
.w {
  color: #fff;
}
</style>
