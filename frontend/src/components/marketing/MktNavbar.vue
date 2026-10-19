<script setup lang="ts">
// 营销导航栏（V5，复刻 src/components/marketing/navbar.tsx）：sticky 顶栏
// （锚点原生 <a>/跨页 router-link 分流）+ 登录态区分（进入工作台 vs 登录/
// 免费开始）+ 移动端菜单。signedIn 由 HomeView 查询会话后传入。
import { ref } from "vue";
import { useTranslation } from "i18next-vue";
import { Menu, Close } from "@element-plus/icons-vue";
import AppLogo from "@/components/AppLogo.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";

const props = withDefaults(defineProps<{ signedIn?: boolean }>(), { signedIn: false });
const { t } = useTranslation();
const open = ref(false);

// 同页锚点（/#features 等）用原生 <a>，交给浏览器做片段导航——router 的
// hash 记账在以 #hash 载入后二次点击会叠加/丢失（Next 16.4 实测，Vue 侧
// 同样保守处理）。跨页路由（/docs）走 router-link。
function navLinks(): { label: string; href: string }[] {
  return [
    { label: t("page.navbar.s2"), href: "/#features" },
    { label: t("page.navbar.s3"), href: "/#workflow" },
    { label: t("page.navbar.s4"), href: "/#pricing" },
    { label: t("page.navbar.s5"), href: "/docs" },
  ];
}
</script>

<template>
  <header class="navbar">
    <div class="inner">
      <AppLogo />

      <nav class="links">
        <template
          v-for="link in navLinks()"
          :key="link.href"
        >
          <a
            v-if="link.href.startsWith('/#')"
            :href="link.href"
            class="link"
          >{{ link.label }}</a>
          <router-link
            v-else
            :to="link.href"
            class="link"
          >
            {{ link.label }}
          </router-link>
        </template>
      </nav>

      <div class="actions">
        <ThemeToggle />
        <template v-if="props.signedIn">
          <router-link
            to="/dashboard"
            class="cta"
          >
            {{ t("page.navbar.s7") }}
          </router-link>
        </template>
        <template v-else>
          <router-link
            to="/login"
            class="ghost"
          >
            {{ t("page.navbar.s0") }}
          </router-link>
          <router-link
            to="/register"
            class="cta"
          >
            {{ t("page.navbar.s1") }}
          </router-link>
        </template>
      </div>

      <div class="mobile-bar">
        <ThemeToggle />
        <button
          type="button"
          class="burger"
          :aria-label="t('page.navbar.s6')"
          @click="open = !open"
        >
          <el-icon :size="15">
            <component :is="open ? Close : Menu" />
          </el-icon>
        </button>
      </div>
    </div>

    <div
      v-if="open"
      class="mobile-menu"
    >
      <nav class="mobile-links">
        <template
          v-for="link in navLinks()"
          :key="link.href"
        >
          <a
            v-if="link.href.startsWith('/#')"
            :href="link.href"
            class="mlink"
            @click="open = false"
          >{{ link.label }}</a>
          <router-link
            v-else
            :to="link.href"
            class="mlink"
            @click="open = false"
          >
            {{ link.label }}
          </router-link>
        </template>
      </nav>
      <div class="mobile-ctas">
        <template v-if="props.signedIn">
          <router-link
            to="/dashboard"
            class="cta full"
            @click="open = false"
          >
            {{ t("page.navbar.s7") }}
          </router-link>
        </template>
        <template v-else>
          <router-link
            to="/login"
            class="ghost full"
            @click="open = false"
          >
            {{ t("page.navbar.s0") }}
          </router-link>
          <router-link
            to="/register"
            class="cta full"
            @click="open = false"
          >
            {{ t("page.navbar.s1") }}
          </router-link>
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--background) / 0.8);
  backdrop-filter: blur(16px);
}
.inner {
  display: flex;
  height: 64px;
  max-width: 80rem;
  align-items: center;
  justify-content: space-between;
  margin: 0 auto;
  padding: 0 16px;
}
@media (min-width: 640px) {
  .inner {
    padding: 0 24px;
  }
}
.links {
  display: none;
  align-items: center;
  gap: 4px;
}
@media (min-width: 768px) {
  .links {
    display: flex;
  }
}
.link {
  padding: 8px 14px;
  border-radius: 9999px;
  font-size: 14px;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.link:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.actions {
  display: none;
  align-items: center;
  gap: 8px;
}
@media (min-width: 768px) {
  .actions {
    display: flex;
  }
}
.ghost {
  padding: 6px 16px;
  border-radius: 9999px;
  font-size: 14px;
  text-decoration: none;
  color: inherit;
}
.ghost:hover {
  background: hsl(var(--accent));
}
.cta {
  padding: 6px 16px;
  border-radius: 9999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 14px;
  text-decoration: none;
}
.cta:hover {
  filter: brightness(1.05);
}
.mobile-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (min-width: 768px) {
  .mobile-bar {
    display: none;
  }
}
.burger {
  display: inline-flex;
  height: 36px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--card));
  cursor: pointer;
  color: inherit;
}
.mobile-menu {
  padding: 16px;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--background) / 0.95);
  backdrop-filter: blur(16px);
}
@media (min-width: 768px) {
  .mobile-menu {
    display: none;
  }
}
.mobile-links {
  display: flex;
  flex-direction: column;
}
.mlink {
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  color: hsl(var(--muted-foreground));
}
.mlink:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.mobile-ctas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid hsl(var(--border));
}
.full {
  display: block;
  text-align: center;
}
.mobile-ctas .full:only-child,
.mobile-ctas .cta.full:first-child:last-child {
  grid-column: span 2;
}
</style>
