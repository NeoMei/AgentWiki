<!-- codex-memory:template=task-brief:v1 -->

# 页面模板库

## 目标

- 为 Space 的“新建页面”增加两步式模板选择。
- 提供空白入口、七个双语系统模板和可版本化的 Space 自定义模板。
- Owner / Admin 管理 Space 模板，Editor 只使用；模板快照不反向修改既有页面。

## 范围 / 不做

- 本期只做单页 Markdown 模板。
- 不做页面套装、个人模板、跨 Space 模板、模板 MCP 或自动翻译。
- 不把页面模板与多 Agent 协作模板混为同一领域。

## 当前状态

- 2026-08-25 已完成逐段设计确认。
- 正式设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`。
- 实施计划：`agentwiki/docs/superpowers/plans/2026-08-25-page-template-library-plan.md`。
- 计划已按数据库合同、系统种子、服务端领域、两步弹窗、Space 管理、编辑器入口、独立数据库和真实浏览器验收分解为 13 个 TDD 任务，本地全部完成。
- 分支 `codex/page-template-library`；2026-08-26 已继续修复最终审查的 Human Admin 入口、detail 权限、焦点/重入、文案、长度和类型契约问题。
- 上一轮 Task 13 全仓门禁：runtime 104 pass / 51 skip、server 1184 pass / 4 skip、client 652/652、build 通过。本轮 fresh 聚焦门禁：schema 8/8、server 196/196、client 235/235、Playwright 静态发现 8 条路径，完整 typecheck/lint/diff-check 通过。
- 专用 `PAGE_TEMPLATE_TEST_DATABASE_URL` 门禁在全新 PostgreSQL 16.14 上 2/2 通过；随机 schema `page_template_test_0430b861a8f2475abbd36f9e6cf130ba` 已 `DROP ... CASCADE`，残留计数 0。
- 上一轮真实 Playwright 在全新 PostgreSQL/Redis/API/Vite 上 7/7 通过；本轮 E2E 源码新增 Human Admin 建页/管理路径及 metadata/version/archive/restore 的 `toBeFocused()` 断言，尚未声称该新增路径已在新栈重跑。
- 验收记录：`agentwiki/docs/testing/page-template-library-acceptance.md`。
- 任务保持 active：本地实施已完成，GitHub/npm/生产发布属于未授权的独立后续工作。

## 完成标准

- 设计获用户书面确认。
- 实施计划覆盖服务端模型、权限、版本、API、前端两步弹窗、模板管理与浏览器验收。
- 本地产品实施、完整 diff 审查、专用真实数据库、真实浏览器和全仓门禁通过。
- 发布完成标准仍未满足：尚未获得 push/部署授权，因包版本未变不计划 npm 发布。
