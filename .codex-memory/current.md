<!-- codex-memory:template=current:v1 -->

# 当前目标

- 为 Space 新建页面增加系统模板与 Space 自定义模板支持，当前完成设计并等待用户审阅正式规格。

# 范围 / 不做

- 范围是单页 Markdown 模板、两步式创建、七个双语系统模板、Space 模板版本与 Owner/Admin 管理。
- 不做页面套装、个人或跨 Space 模板、模板自动翻译、新模板 MCP，也不修改协作工作流模板。

# 当前状态

- 2026-08-25 已确认产品范围、模板目录、两步式交互、独立快照、权限、版本、API、异常和验收标准。
- 正式设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`。
- 活跃任务：`.codex-memory/tasks/active/page-template-library/`。
- 尚未编写实施计划或修改产品代码。
- 上一生产发布提交仍为 `d843fba620c5cfaf8a1b68d96aa21596f56dad5c`；本任务没有发布授权。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；页面模板与协作模板是两个独立领域，不得混用。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- Markdown 编辑继续使用互斥的 Edit / Preview 工作区；所有新增界面文案必须支持简体中文和英文。

# 关键索引

- 页面模板设计：`agentwiki/docs/superpowers/specs/2026-08-25-page-template-library-design.md`
- 页面模板任务：`.codex-memory/tasks/active/page-template-library/`
- 上一发布记录：`agentwiki/docs/verification/collaboration-agent-preparation-2026-08-25.md`

# 风险 / 下一步

- 用户审阅并批准正式设计后，按 brainstorming 流程转入实施计划。
- 实施前需要用测试固定模板权限、不可变版本、跨 Space 拒绝、模板故障时空白页降级和 390px 弹窗行为。
- 未经单独授权，不推送 GitHub、不发布 npm、不部署生产。
