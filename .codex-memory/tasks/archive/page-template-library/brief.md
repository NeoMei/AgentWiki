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
- 计划按数据库合同、系统种子、服务端领域、两步弹窗、Space 管理、编辑器入口、独立数据库和真实浏览器验收分解；全部 TDD 任务、审查项和验收项已完成。
- 应用发布提交为 `574f25402e83abcaf66a2d5d490ec67269b0b962`；已推送 GitHub 并部署生产，旧候选分支已删除。
- 2026-08-26 又完成三类重复收敛审查：任务/设计完成度、前后端代码与并发边界、全栈/UI 交互。累计修复 9 类问题；最后一轮补齐失败翻页按原偏移重试和目录运行时整数/范围校验，修复后多轮复查未再发现值得修复的问题。
- 最终全仓门禁：runtime 104 pass / 51 skip、server 1213 pass / 4 skip、client 732/732、sync-protocol 42/42、local-sync 748/748；typecheck、lint、build 全部通过。
- 专用 `PAGE_TEMPLATE_TEST_DATABASE_URL` 门禁在全新 PostgreSQL 16 上 2/2 通过，含 U+20000 Prisma 往返；随机 schema 已删除，全部 `page_template_test_%` 残留计数 0。
- 真实 Chrome 在全新 PostgreSQL/Redis/API/Vite 上 10/10 通过，包含真实冲突恢复、首页与失败翻页偏移的故障注入重试及逐次消费的预期控制台错误；20 轮、160 个有序并发对全部通过，孤儿记录、锁等待者与活跃测试 fixture 均为 0。
- 验收记录：`agentwiki/docs/testing/page-template-library-acceptance.md`。
- 2026-08-26 GitHub 与生产发布完成；第 43 个迁移已应用，762 个部署文件哈希一致，公网业务 smoke 31/31、页面模板 Chrome 10/10 和通用 UI 路由 5+15+6 通过。两个 npm 包目录无差异且版本与 registry 一致，本次未发布 npm。
- 活跃验收 fixture、可见测试 Space 模板和测试 schema 均为 0；任务已归档。

## 完成标准

- 设计获用户书面确认。
- 实施计划覆盖服务端模型、权限、版本、API、前端两步弹窗、模板管理与浏览器验收。
- 本地产品实施、完整 diff 审查、专用真实数据库、真实浏览器和全仓门禁通过。
- GitHub 推送、生产双备份、迁移、部署、文件指纹与公网登录态验收均已完成；因包版本未变未发布 npm。
