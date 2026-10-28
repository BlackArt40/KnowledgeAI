<script setup lang="ts">
// 主题三模式切换（light/dark/system）：薄封装共享主题引擎，与 Next 侧
// components/theme-toggle.tsx 同一份 localStorage（kai-theme）。
import { Moon, Sunny, Monitor } from "@element-plus/icons-vue";
import { useThemeStore, type ThemeMode } from "@/stores/theme";

const theme = useThemeStore();

const options: { value: ThemeMode; icon: typeof Sunny }[] = [
  { value: "light", icon: Sunny },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

function iconFor(mode: ThemeMode) {
  return options.find((o) => o.value === mode)?.icon ?? Sunny;
}
</script>

<template>
  <el-dropdown
    trigger="click"
    @command="theme.setMode($event, { animate: true })"
  >
    <button
      class="theme-toggle"
      :aria-label="'theme'"
    >
      <el-icon :size="16">
        <component :is="iconFor(theme.mode)" />
      </el-icon>
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="o in options"
          :key="o.value"
          :command="o.value"
          :class="{ active: theme.mode === o.value }"
        >
          <el-icon><component :is="o.icon" /></el-icon>
          {{ o.value }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.theme-toggle {
  display: flex;
  height: 34px;
  width: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease;
}
.theme-toggle:hover {
  border-color: hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
}
.active {
  color: hsl(var(--primary));
  font-weight: 600;
}
</style>
