<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 协作运行“映射 Agent”站内准备能力已发布；当前进入生产观察与正常迭代阶段。

# 范围 / 不做

- 已上线已有/新建 Agent、paused 恢复、当前 Space Editor/Publisher 授权、MCP 一次性接入指令、接入检测和当前 Role Slot 自动选择。
- 不自动启动外部 Agent，不修改协作调度/模板/状态机，不批量映射全部角色。
- 本次没有修改 npm 包版本；Local Sync 保持 `0.6.1`，Sync Protocol 保持 `0.3.0`。

# 当前状态

- 应用发布提交为 `d843fba620c5cfaf8a1b68d96aa21596f56dad5c`；本地与 GitHub `master` 已对齐。
- 2026-08-25 生产发布完成：staging 构建通过，PostgreSQL 42 条迁移均已是最新，API、Worker、Frontend 三项用户服务 active 且 `NRestarts=0`。
- 公网 `/`、`/guide`、`/onboard` 返回 200；`/api/health` 的 database、Redis、audit persistence 均为 `ok`；发布窗口 error/fatal/unhandled 日志为 0。
- 部署包 727 个受版本控制文件的本地/生产 SHA-256 全部一致；生产 `collaboration_test_*` schema 为 0。
- 已登录生产 Browser 验收确认：空 Agent 映射出现逐角色“准备 Agent”和“准备第一个 Agent”；弹窗支持已有/新建 Agent，展示 Reader 到 Editor/Publisher 的授权路径；关闭焦点恢复正确。
- 390×844 页面和弹窗均无横向溢出，console error/warn 为 0；生产验收未提交 Agent 或授权变更。
- 回滚材料：数据库 `/root/backups/agentwiki/pre-collaboration-agent-preparation-20260825-105901.dump`，应用 `/root/backups/agentwiki/pre-collaboration-agent-preparation-20260825-105901-app.tar.gz`，上一版应用树 `/root/agentwiki-previous-20260825110227`。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；人工审核只能由人类完成；指定审核人失效时只允许 Owner/Admin 走审计恢复通道。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- Obsidian 连接从“使用指南”内部进入；全局导航与个人菜单不再提供独立“连接 Obsidian”目的地。

# 关键索引

- 设计：`agentwiki/docs/superpowers/specs/2026-08-25-collaboration-agent-preparation-design.md`
- 计划：`agentwiki/docs/superpowers/plans/2026-08-25-collaboration-agent-preparation-plan.md`
- 本地验收：`agentwiki/docs/testing/collaboration-agent-preparation-acceptance.md`
- 发布记录：`agentwiki/docs/verification/collaboration-agent-preparation-2026-08-25.md`
- 已归档任务：`.codex-memory/tasks/archive/collaboration-agent-preparation/`

# 风险 / 下一步

- 继续观察生产协作运行、Agent 接入与授权审计；若回滚应用，必须同时恢复本次发布前数据库备份。
- npm 包未变化，后续只有在协议或 Local Sync 产物变化时才递增版本并单独发布。
