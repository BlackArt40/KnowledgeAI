# 前端 V3 验收文档（Vue 3 绞杀重写 · 知识库 + 团队 + API 密钥）

- 日期：2026-10-16
- 阶段：前端替换 V3（承接 V2；service-split.md 阶段 6「前端替换」）
- 结论：**通过**（门禁 + e2e 20/20 + 演练）

## 1. 范围（+5 路由，累计 18/28）

- **/knowledge-base 列表**（KbListView）：卡片网格（stats{total,ready,processing,chunks}/shared/ownerName/updatedAt）、新建对话框（name/desc/color/initial，POST 201 {kb}）、owner 删除、`?new=1` 深链接开对话框并清参
- **/knowledge-base/[id] 详情**（KbDetailView）：统计 chips + 上传区（multipart 字段 `files`，201={docs,errors} 已入队）+ 文档表（状态徽章 + 处理中 3s 轮询到终态 + 删除）+ KB 设置（PATCH 改名/删库）+ 图谱入口
- **/knowledge-base/[id]/graph**（KbGraphView）：`computeGraphLayout`（@shared 复用 d3-force tick(300) 纯函数，frontend 新增 d3-force 依赖）+ SVG 节点按类型着色/边按权重/点击选中高亮 1-hop 邻居/搜索高亮；空态引导上传
- **/team**（TeamView）：GET /api/team 聚合（members/stats/sharedKbs+memberRoles/audit manager 可见）+ 邀请（POST /api/team/invite）+ 角色变更/移除（members/[id] PATCH/DELETE，owner 不可删）
- **/api-keys**（ApiKeysView）：脱敏列表 + 创建（scope 白名单与 /lib/apikeys/types 一致，一次性明文 secret 对话框 + 复制）+ 撤销；新增 i18n key `page.api-keys.s27`（zh/en 同步）
- AppShell 导航 4 项改 router-link（knowledge-base/team/api-keys）；routes.conf 增 3 条（/knowledge-base、/knowledge-base/*、/team、/api-keys）

## 2. 门禁与测试

| 门禁 | 结果 |
| --- | --- |
| frontend 四门禁 | ✅ |
| frontend/e2e（auth 9 + workbench 7 + kb 4） | ✅ **20/20** |
| i18n 扫描 4/4（新增 s27 zh/en 同步；修掉 3 处中文 confirm fallback） | ✅ |
| 根仓 tsc / lint / test:unit / docs:build | ✅ 双轨零回归 |
| clean-machine-drill（15 路由） | ✅ PASS=21 FAIL=0 |

## 3. 实测发现并修复

1. **vite proxy 前缀误伤**：`"/api"` 前缀把 `/api-keys` **页面**也代理到 Next（Next 有同名页 → Vue 视图不挂载、e2e 按钮永远找不到）——改 `^/api/` 正则；
2. **FormData 被序列化**：client.ts 对 FormData 也设 JSON Content-Type 且 JSON.stringify body（multipart 上传必挂）——FormData 透传且不设 Content-Type；
3. **i18n 命名空间臆造**：初版用了不存在的 `page.knowledge-base.*`——对齐真实命名空间（`page.kb` / `page.new-kb-dialog` / `page.upload-zone` / `page.document-list` / `page.kb-settings-dialog` / `page.knowledge-base-[id]` / `page.knowledge-graph` / `page.team` / `page.invite-dialog` / `page.api-keys`）；
4. 中文 confirm fallback 被 i18n 扫描抓出 → 全部改用既有 key；
5. api-keys 撤销断言改为行数减一（dev 环境历史 key 累积）。

## 4. 遗留与后续

- 图谱拖拽/缩放（Next 版有）在 Vue 侧为静态布局 + 选中高亮——V4 一并补交互；
- KB 详情的 per-doc 分享（doc-share 对话框）、网页链接上传、KB 设置高级项（切片参数/embedding 选择）暂未上——V4 评估补齐；
- V4：/chat（SSE/markdown/引用/语音）+ /agent（SSE）+ /billing /checkout /usage。
