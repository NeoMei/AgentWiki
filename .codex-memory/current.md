<!-- codex-memory:template=current:v1 -->

# 当前目标

- 对 Agent 协作模板与组件执行多轮任务、代码、全栈与真实 UI 审查，修复全部值得修复的缺陷。
- 完成 Sync Protocol `0.3.0`、Local Sync `0.6.0` 与生产部署发布链，并核对四个发布面。

# 范围 / 不做

- 已完成编码、标书、论文、视频脚本和小说五类模板，以及 Agent 任务、顺序 Todo、依赖/并行、人工审核、结果交接/汇总、六个 MCP 工具与 Space UI。
- 继续复用 `AgentGrant.role` 单一权限事实；Agent 不获得人类审核权限，不引入第二套 Credential scopes 或授权入口。
- 本地完成不代表 npm 或生产已更新；用户已授权继续完整发布链。

# 当前状态

- 本轮又完成三轮任务/代码/安全复核：修复“单个节点大量旧评审挤掉其他当前评审”与“WebSocket 运行房间不清退已失权成员”两个缺陷，均完成 RED→GREEN；第三轮未发现新的值得修复项。
- 最新门禁：Runtime 95 通过/50 环境跳过；Server 1005 通过/3 跳过；Client 316/316；Sync Protocol 42/42；Local Sync 748/748；lint、typecheck、build、`git diff --check`、Prisma validate 全部通过。
- 隔离 PostgreSQL schema 2/2、真实事务 10/10、API/Worker/Credential/MCP E2E `PASS`；双 tarball 空目录安装与 CLI 启动确认 Local Sync `0.6.0` 精确使用 Sync Protocol `0.3.0`。
- 最新真实浏览器完成注册、Space/Agent 创建与授权、五模板、三步启动、六角色分配、8 任务/Todo 看板、暂停/恢复和历史审计；390px 页面无横向溢出，控制台无 error/warn，Obsidian 仅保留在使用说明。
- 全部随机 `collaboration_test_*` schema、UI 验收 schema、Harness 状态文件与临时服务均已清理；无测试资源落入 `public`。
- 本地 `master` 与 GitHub `origin/master` 已对齐到 `ca03eb220a8db66f1a716f281ab43fc98bbff5c5`。
- npm 仍为 Sync Protocol `0.2.0`、Local Sync `0.5.1`；生产仍公告 Local Sync `0.5.1`，本轮全面审查与发布收口正在进行。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；人工审核只能由人类完成；指定审核人失效时只允许 Owner/Admin 走审计恢复通道。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- Sync Protocol 独立 semver；发布顺序必须是 protocol `0.3.0` → registry 验证 → local-sync `0.6.0`。
- Obsidian 连接从“使用指南”内部进入；全局导航与个人菜单不再提供独立“连接 Obsidian”目的地，`/guide` 在 Obsidian 子路由上保持激活。

# 关键索引

- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板实施计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 最终发行审查计划：`docs/superpowers/plans/2026-08-24-collaboration-release-final-audit.md`
- 真实客户端与最终门禁：`agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- 已归档协作任务：`.codex-memory/tasks/archive/agent-collaboration-templates/`
- 当前发布收口任务：`.codex-memory/tasks/active/collaboration-release-finalization-2026-08-24/`
- 既有安全/发布任务：`.codex-memory/tasks/archive/comprehensive-security-reliability-audit-2026-08-23/`

# 风险 / 下一步

- 本地候选此前已达到发布标准；用户现要求再次执行多轮任务、代码、全栈与 UI 审查后完成发布。
- npm registry 当前仍是 Sync Protocol `0.2.0` 与 Local Sync `0.5.1`；registry 依赖门禁在 protocol `0.3.0` 发布前保持预期 `PENDING`。
- 生产部署前必须做只读主机/数据库/应用预检，并从应用 `.env` 确认目标数据库，创建并验证 PostgreSQL 与应用回滚备份后再迁移、部署和业务烟测。
- 发布完成后必须分别报告本地 `master`、`origin/master`、npm 与生产四个表面的对齐状态。
