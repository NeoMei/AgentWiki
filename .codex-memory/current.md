<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 协作模板与组件的多轮审查、修复、npm/GitHub 发布和生产部署已经完成；当前无活跃发布任务。

# 范围 / 不做

- 已完成编码、标书、论文、视频脚本和小说五类模板，以及 Agent 任务、顺序 Todo、依赖/并行、人工审核、结果交接/汇总、六个 MCP 工具与 Space UI。
- 继续复用 `AgentGrant.role` 单一权限事实；Agent 不获得人类审核权限，不引入第二套 Credential scopes 或授权入口。
- 本地、GitHub、npm 与生产必须分别留存证据；本次四个发布面均已完成核验。

# 当前状态

- 本轮完成三轮任务/代码/安全复核：修复“单个节点大量旧评审挤掉其他当前评审”与“WebSocket 运行房间不清退已失权成员”两个缺陷，均完成 RED→GREEN；第三轮代码复核未发现新的值得修复项。随后真实 npm 发布验收又发现 `workspace:` 依赖导致 `0.6.0` 无法公开安装，已补充失败契约测试并修复为 `0.6.1`。
- 最新门禁：Runtime 95 通过/50 环境跳过；Server 1005 通过/3 跳过；Client 316/316；Sync Protocol 42/42；Local Sync 748/748；lint、typecheck、build、`git diff --check`、Prisma validate 全部通过。
- 隔离 PostgreSQL schema 2/2、真实事务 10/10、API/Worker/Credential/MCP E2E `PASS`；修订后的 npm 产物门禁确认 Local Sync `0.6.1` 精确使用 registry Sync Protocol `0.3.0`，748/748 与空目录安装/CLI 启动均通过。
- 最新真实浏览器完成注册、Space/Agent 创建与授权、五模板、三步启动、六角色分配、8 任务/Todo 看板、暂停/恢复和历史审计；390px 页面无横向溢出，控制台无 error/warn，Obsidian 仅保留在使用说明。
- 全部随机 `collaboration_test_*` schema、UI 验收 schema、Harness 状态文件与临时服务均已清理；无测试资源落入 `public`。
- 本地 `master` 与 GitHub `origin/master` 已包含可安装的 `0.6.1` 发布修复、最终验收门禁和生产收口记录；最终哈希以当前 `git HEAD` 为准。
- npm Sync Protocol `0.3.0` 与 Local Sync `0.6.1` 均已发布并完成 shasum/integrity、公开元数据和空目录安装反验；CLI 返回 `0.6.1`。损坏的 Local Sync `0.6.0` 已标记弃用并明确要求升级。
- 生产已从 `0.5.1/0.2.0` 升级为 AgentWiki/Local Sync `0.6.1`、Sync Protocol `0.3.0`；42 条迁移全部 applied，API/Worker/Frontend 均 active 且重启计数为 0，公网健康项全部为 `ok`。
- 发布后公网 API/MCP smoke 连续两轮 31/31；UI smoke 最终连续通过 5 个公共、15 个登录后和 6 个移动路由。验收脚本已把旧 `/settings/integrations` 明确归入 `/guide/obsidian` 兼容重定向；生产活跃 smoke User/Space/Agent 与 `collaboration_test_*` schema 均为 0。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；人工审核只能由人类完成；指定审核人失效时只允许 Owner/Admin 走审计恢复通道。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- Sync Protocol 独立 semver；当前修订发布顺序必须是 protocol `0.3.0` → registry 验证 → local-sync `0.6.1` → 弃用损坏的 `0.6.0`。
- Obsidian 连接从“使用指南”内部进入；全局导航与个人菜单不再提供独立“连接 Obsidian”目的地，`/guide` 在 Obsidian 子路由上保持激活。

# 关键索引

- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板实施计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 最终发行审查计划：`docs/superpowers/plans/2026-08-24-collaboration-release-final-audit.md`
- 真实客户端与最终门禁：`agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- 已归档协作任务：`.codex-memory/tasks/archive/agent-collaboration-templates/`
- 已归档发布收口任务：`.codex-memory/tasks/archive/collaboration-release-finalization-2026-08-24/`
- 既有安全/发布任务：`.codex-memory/tasks/archive/comprehensive-security-reliability-audit-2026-08-23/`

# 风险 / 下一步

- 发布链已完成，无已知值得修复的缺陷或未完成门禁。
- 保留回滚证据 `/root/backups/agentwiki/pre-collaboration-061-20260824T205059+0800.*` 与旧应用树 `/root/agentwiki-previous-20260824205509`；旧应用树不能脱离匹配数据库备份单独恢复。
- 后续只需常规监控；如开启新需求，应创建新的 active task，而不是继续追加本次已归档任务。
