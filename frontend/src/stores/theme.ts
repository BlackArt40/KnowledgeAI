// 主题 Pinia store：薄封装共享主题引擎（@shared/theme/mode + brand-colors），
// 状态本体的持久化与 DOM 应用全部在引擎侧（与 Next 端同 key：kai-theme/kai-hc）。
import { defineStore } from "pinia";
import {
  applyHighContrast,
  applyTheme,
  getHighContrast,
  getStoredTheme,
  resolveMode,
  subscribeSystemTheme,
  type ThemeMode,
} from "@shared/theme/mode";
import {
  applyBrandColor,
  DEFAULT_BRAND_COLOR,
  isValidBrandColor,
} from "@shared/theme/brand-colors";

// 供组件直接从 store 取主题模式类型（mode.ts 是共享单源）
export type { ThemeMode };

export const useThemeStore = defineStore("theme", {
  state: () => ({
    mode: getStoredTheme(),
    highContrast: getHighContrast(),
    brandColor: DEFAULT_BRAND_COLOR,
  }),
  getters: {
    resolvedDark: (state) => resolveMode(state.mode) === "dark",
  },
  actions: {
    setMode(mode: ThemeMode, opts: { animate?: boolean } = {}) {
      applyTheme(mode, { animate: opts.animate });
      this.mode = mode;
    },
    setHighContrast(on: boolean) {
      applyHighContrast(on);
      this.highContrast = on;
    },
    /** V2 工作台接入 workspace.brandColor 后由设置页调用（P4-3 契约不变）。 */
    setBrandColor(id: string) {
      if (!isValidBrandColor(id)) return;
      applyBrandColor(id);
      this.brandColor = id;
    },
    /** App.vue 挂载时调用一次：应用默认品牌色 + 订阅系统主题变化。 */
    init() {
      applyBrandColor(this.brandColor);
      subscribeSystemTheme(() => {
        // 系统跟随回放是「默认态的重申」而非用户选择——不持久化，保持
        // kai-theme 缺失 = 跟随系统的契约（CI 实测：回放会把 "system" 写进
        // localStorage，破坏「未存储」默认态，test-theme-ui 断言失败）。
        if (this.mode === "system") applyTheme("system", { persist: false });
      });
    },
  },
});
