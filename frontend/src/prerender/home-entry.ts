// 首页预渲染 SSR 入口（V5）：只挂 HomeView 的最小 Vue 应用——i18n（共享
// 语言包单例，zh-CN 默认）+ HomeView 依赖的组件树。不能引入 router/
// Pinia/EP 全量样式（预渲染只产出静态 DOM，样式由 index.html 的既有 link
// 提供）。组件内的 window/document 访问都在 onMounted/computed 守卫内。
import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import I18NextVue from "i18next-vue";
import { renderToString } from "vue/server-renderer";
import { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from "element-plus";
import { getI18nInstance } from "@shared/i18n/translate";
import HomeView from "@/views/HomeView.vue";

export async function renderHome(): Promise<string> {
  const app = createSSRApp(HomeView);
  // pinia：导航栏的 ThemeToggle 读 theme store，SSR 需注册实例（默认态渲染）
  app.use(createPinia());
  // EP 组件（ThemeToggle 的 el-dropdown）在 SSR 需要 id/zindex 注入（官方约定）
  app.provide(ID_INJECTION_KEY, { prefix: 1024, current: 0 });
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 });
  app.use(I18NextVue, { i18next: getI18nInstance() });
  return renderToString(app);
}
