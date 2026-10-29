// V0 工程基座入口：Pinia + vue-router + i18next-vue（共享单例）+ Element Plus 样式。
import { createPinia } from "pinia";
import I18NextVue from "i18next-vue";
import { createApp } from "vue";

import App from "./App.vue";
import { router } from "./router";
import { initLocale } from "./lib/i18n";
import { getI18nInstance } from "@shared/i18n/translate";
import { clientLog } from "@shared/obs/log-browser";
import { registerSw } from "./pwa/sw-register";
import { installGlobalErrorReporter, reportClientError } from "./lib/error-reporter";

// 样式顺序：EP 基础 → EP 暗色变量 → 本项目 tokens → EP 变量适配（最后加载者胜，
// element-adapter.css 依赖该顺序覆盖 html.dark 下的 EP 变量）。
import "element-plus/theme-chalk/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles/tokens.css";
// 元素级基线：盒模型 / body 排版 / 选中色 / 焦点环 / 减少动效
import "./styles/base.css";
import "./styles/element-adapter.css";
// 全局工具样式：细滚动条（.kai-scroll）+ 基础类（.card / .badge / .sk / ...）
import "./styles/scrollbar.css";
import "./styles/utility.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);
// 共享 i18next 单例（../src/lib/i18n/translate.ts）：与 Next 同一份语言包与
// 插值配置，禁止在 frontend 侧复制 JSON。
app.use(I18NextVue, { i18next: getI18nInstance() });

initLocale();

// 全局错误兜底：本地结构化日志（浏览器控制台）+ 上报 /api/obs/report
// （服务端错误环 / Sentry，30s 同类去重，见 lib/error-reporter.ts）。
installGlobalErrorReporter();
app.config.errorHandler = (err, _instance, info) => {
  clientLog.error({ err, info }, "[vue] unhandled error");
  const e = err instanceof Error ? err : new Error(String(err));
  reportClientError(e.message, e.stack, `vue:${info}`);
};

// P5-1 → V6：PWA 注册（仅生产；dev 下缓存会与 HMR 抢新产物）
registerSw();

app.mount("#app");
