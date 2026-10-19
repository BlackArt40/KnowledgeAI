import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

// tseslint.config() 在 v8.71+ 已弃用，直接导出扁平配置数组
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      // unplugin 生成的全局类型声明（提交但禁止手改）
      "src/auto-imports.d.ts",
      "src/components.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  // vue 配置必须在 tseslint 之后：tseslint 的全局 parser 声明会覆盖
  // vue-eslint-parser，后声明者对 *.vue 生效
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, sourceType: "module" },
    },
  },
  {
    files: ["src/App.vue"],
    rules: { "vue/multi-word-component-names": "off" },
  },
  {
    // markdown 渲染 v-html：markdown-it 均以 html:false 构造（原始 HTML
    // 一律转义），v-html 注入的是已净化输出（引用 chip 由渲染层注入），
    // 规则豁免有据
    files: [
      "src/views/share/SharedReportView.vue",
      "src/components/chat/MessageBubble.vue",
      "src/views/AgentView.vue",
    ],
    rules: { "vue/no-v-html": "off" },
  },
  {
    rules: {
      // 与根仓一致的 unused-vars 宽免约定（_ 前缀 + rest-sibling）
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];
