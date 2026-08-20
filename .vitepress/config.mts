import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// KnowledgeAI 文档站点配置
// 文档源目录为 docs/（docs-as-code，与代码同仓库）
export default withMermaid(defineConfig({
  title: 'KnowledgeAI 文档中心',
  description: 'KnowledgeAI 技术文档：入门指南、架构设计、API 参考、开发规范、部署运维与 FAQ',
  lang: 'zh-CN',
  srcDir: 'docs',
  // superpowers = L0 草稿；archive 保留可访问（status: archived，只归档不删除）
  srcExclude: ['superpowers/**', 'screenshots/**'],
  cleanUrls: true,
  lastUpdated: true,
  // 存量中文文件名迁移重定向（旧链接 → 新路径，避免死链）
  rewrites: {
    '产品文档.md': 'getting-started/product-overview.md',
    '项目结构.md': 'getting-started/project-structure.md',
    '设计说明.md': 'architecture/design-system.md',
    'ROADMAP.md': 'archive/ROADMAP.md',
    '技术文档体系方案.md': 'standards/technical-docs-strategy.md'
  },

  themeConfig: {
    siteTitle: 'KnowledgeAI 文档中心',
    nav: [
      { text: '文档中心', link: '/' },
      { text: '文档规范', link: '/standards/README' },
      { text: '产品概述', link: '/getting-started/product-overview' },
      { text: 'GitHub', link: 'https://github.com/' }
    ],
    sidebar: {
      '/': [
        {
          text: '文档中心',
          items: [
            { text: '文档门户', link: '/' }
          ]
        },
        {
          text: '入门指南',
          items: [
            { text: '快速开始', link: '/getting-started/quickstart' },
            { text: '新成员入门指南', link: '/getting-started/onboarding' },
            { text: '贡献指南', link: '/getting-started/contribution-guide' },
            { text: '演示账号', link: '/getting-started/demo-accounts' },
            { text: '产品概述', link: '/getting-started/product-overview' },
            { text: '项目结构', link: '/getting-started/project-structure' }
          ]
        },
        {
          text: '文档规范与模板',
          link: '/standards/README',
          items: [
            { text: '技术文档体系方案', link: '/standards/technical-docs-strategy' },
            { text: '文档编写规范', link: '/standards/doc-writing-standards' },
            { text: '文档评审 Checklist', link: '/standards/doc-review-checklist' },
            { text: '术语表', link: '/standards/glossary' },
            { text: '新文档模板', link: '/standards/templates/new-doc' },
            { text: 'ADR 模板', link: '/standards/templates/adr' }
          ]
        },
        {
          text: '架构设计',
          items: [
            { text: '总体架构', link: '/architecture/overview' },
            { text: 'RAG 引擎架构', link: '/architecture/rag-engine' },
            { text: 'Agent 编排架构', link: '/architecture/agent-orchestration' },
            { text: 'UI 设计体系', link: '/architecture/design-system' },
            { text: 'ADR-0001 内存存储+写穿 DB', link: '/architecture/adr/adr-0001-in-memory-store-write-through-db' },
            { text: 'ADR-0002 后台任务队列', link: '/architecture/adr/adr-0002-background-job-queue' }
          ]
        },
        {
          text: 'API 与 SDK',
          items: [
            { text: 'API 使用指南', link: '/api/guide' },
            { text: 'API 参考（自动生成）', link: '/api/reference' },
            { text: '错误码表', link: '/api/errors' },
            { text: 'Webhook 指南', link: '/api/webhooks' },
            { text: 'JavaScript SDK', link: '/api/sdk-javascript' },
            { text: 'Python SDK', link: '/api/sdk-python' },
            { text: 'Go SDK', link: '/api/sdk-go' }
          ]
        },
        {
          text: '部署运维',
          items: [
            { text: '部署指南', link: '/ops/deployment-guide' },
            { text: '环境变量全表', link: '/ops/env-vars' },
            { text: '监控与告警', link: '/ops/monitoring' }
          ]
        },
        {
          text: 'FAQ 与排障',
          items: [
            { text: '常见问题 FAQ', link: '/faq/faq' },
            { text: '故障排查手册', link: '/faq/troubleshooting' }
          ]
        },
        {
          text: '归档（只读）',
          items: [
            { text: '开发路线图 ROADMAP', link: '/archive/ROADMAP' },
            { text: '设计与实现记录', link: '/archive/design-and-implementation-log' }
          ]
        }
      ]
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '主题切换',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    langMenuLabel: '语言'
  }
}))
