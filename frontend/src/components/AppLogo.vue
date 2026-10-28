<script setup lang="ts">
// 品牌字标：品牌色方形标记 + 单色字标（light 变体整体反白，用于深色/品牌底）。
// 绞杀期链接语义：/ 在网关切到 Vue 前仍是 Next 官网首页，用 <a> 全页跳转。
defineProps<{ light?: boolean }>();
</script>

<template>
  <a
    href="/"
    class="logo"
    :class="{ light }"
  >
    <span
      class="mark"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 28 28"
        fill="none"
      >
        <path d="M8 6.5v15M8 14l8-7.5M8 14l8 7.5" />
        <circle
          cx="19"
          cy="6.5"
          r="2"
        />
        <circle
          cx="19"
          cy="21.5"
          r="2"
        />
      </svg>
    </span>
    <span class="word">KnowledgeAI</span>
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
  height: 34px;
  width: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: hsl(var(--primary));
  box-shadow: 0 5px 14px hsl(var(--primary) / 0.2), inset 0 0 0 1px rgb(255 255 255 / 0.16);
  color: #fff;
}
.mark svg {
  width: 25px;
  height: 25px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mark circle {
  fill: currentColor;
  stroke: none;
}
.word {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.035em;
  color: hsl(var(--foreground));
}
/* 反白变体（深色/品牌底上）：字标与标记一起反白 */
.logo.light .word {
  color: #fff;
}
.logo.light .mark {
  background: rgb(255 255 255 / 0.18);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.35);
}
</style>
