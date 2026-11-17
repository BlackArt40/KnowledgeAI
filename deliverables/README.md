# 交付物索引（deliverables/）

本目录按时间线收录各轮审计、修复与体检的交付物。**历史批次保留用于决策沿革追溯**；各批次的阻塞项/遗留项状态以本索引右列为准。

| 批次 | 日期 | 结论 | 产出 | 状态 |
|------|------|------|------|------|
| 上线前全检 + 修复（gstack） | 2026-08-20 | 🟡 条件 Go → 39 项当轮修复 | [修复纪要](gstack/README.md)（原 5 份已整合） | ✅ 已并入主干 |
| 工程保障审计（engineering-assurance） | 2026-09-30 | 🔴 No-Go（4 安全阻塞 + k8s 冲突） | [代码审查](engineering-assurance/code-review-knowledgeai-2026-09-30.md) · [事故复盘](engineering-assurance/incident-login-page-after-shutdown-2026-09-30.md) · [技术债](engineering-assurance/tech-debt-knowledgeai-2026-09-30.md) · [Go/No-Go](engineering-assurance/pre-deploy-go-no-go-knowledgeai-2026-09-30.md) · [修复交付](engineering-assurance/remediation-knowledgeai-2026-09-30.md) | ✅ 阻塞项已修复（PR #27 合并 `593c0af`） |
| 上线体检（software-company） | 2026-10-08 | 🟡 No-Go → 修复后 Go | [体检主报告](software-company/launch-readiness-knowledgeai-2026-10-08.md) · [QA 门禁验证](software-company/qa-launch-check-2026-10-08.md) · [架构复核](software-company/arch-launch-check-2026-10-08.md) | ✅ 收尾修复已合并（PR #28 `40f8ce9`） |
| 依赖漏洞治理 | 2026-10-08 | 59 → 3（critical 清零）+ CI 审计门禁 | [治理记录](software-company/dependency-remediation-2026-10-08.md) | ✅ 已合并（PR #29 `dd8fb93`） |
| 服务拆分阶段验收（stage 1-6） | 2026-10-12 ~ 10-13 | ✅ 六阶段逐项通过，G1-G10 跨阶段总检放行 | [阶段一](service-split/stage1-acceptance-2026-10-12.md) · [阶段二](service-split/stage2-acceptance-2026-10-12.md) · [阶段三](service-split/stage3-acceptance-2026-10-12.md) · [阶段四](service-split/stage4-acceptance-2026-10-13.md) · [阶段五](service-split/stage5-acceptance-2026-10-13.md) · [阶段六](service-split/stage6-acceptance-2026-10-13.md) · [总检放行评审](service-split/final-review-gmatrix-2026-10-13.md) | ✅ 已验收（生产轨道放行） |
| 前端绞杀重写验收（V1-V8） | 2026-10-16 ~ 10-19 | ✅ 八阶段全部通过，Next 页面层退役（V6 收官） | [V1 认证/静态/分享](service-split/frontend-v1-acceptance-2026-10-16.md) · [V2 工作台](service-split/frontend-v2-acceptance-2026-10-16.md) · [V3 知识库](service-split/frontend-v3-acceptance-2026-10-16.md) · [V4 聊天/Agent/账务](service-split/frontend-v4-acceptance-2026-10-17.md) · [V5 管理端](service-split/frontend-v5-acceptance-2026-10-17.md) · [V6 收官](service-split/frontend-v6-acceptance-2026-10-17.md) · [V7 遗留修复](service-split/frontend-v7-acceptance-2026-10-19.md) · [V8 遗留清零](service-split/frontend-v8-acceptance-2026-10-19.md) | ✅ 已验收（Vue 全量接管页面路由） |

## 说明

- **gstack 批次**：原 5 份原始记录（`pre-launch-check` + `p0/p1/m/l-fix`）已于 2026-10-08 文档治理整合为 [gstack/README.md](gstack/README.md)；需检索全文时使用 git 历史（`git log --all -- deliverables/gstack/`）。
- **状态口径**：✅ 表示该批识别出的阻塞/待办项已处置完毕或已按计划转入后续里程碑登记（技术债、ADR 等）。
- 新的审计/体检交付物应加入本表，并在落盘时同步更新对应行。
