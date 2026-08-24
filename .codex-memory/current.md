<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 协作运行“映射 Agent”站内准备实现已完成本地全门禁与真实端到端验收；当前保持发布前 active，等待独立授权后才可 push/发布/部署。

# 范围 / 不做

- 范围包含已有/新建 Agent、paused 恢复、当前 Space Editor/Publisher 授权、MCP 一次性接入指令、接入检测和当前 Role Slot 自动选择。
- 不自动启动外部 Agent，不修改协作调度/模板/状态机，不批量映射全部角色。
- 继续复用 `AgentGrant.role` 单一权限事实；Agent 不获得人类审核权限，不引入第二套 Credential scopes 或授权入口。
- 未经独立授权不推送、不发布 npm、不部署生产。

# 当前状态

- Tasks 1–5 已在本地实现向导内创建/恢复、Grant、Local Sync 一次性接入、自动检测、当前 Slot 映射、待接入警告与权限边界。
- Task 6 本地验收完成：核心 66 个 server + 103 个 client 测试通过；纯测试合同补充提交 `658538c` 上全仓 2,304 个测试通过，53 个既有环境依赖测试跳过；lint/typecheck/build/diff 通过。
- Browser 真实路径已在 product runtime `e83d153` 完成桌面与 390px 验收；Owner/Admin、Editor 无 mutation/ownerRequired、无 SpaceMember 的 platform Super Admin 均通过，关键移动状态 7/7 的 `scrollWidth === 390`，Browser console 0 error/warn。`658538c` 仅新增测试，未重跑 Browser。
- 验收中发现 worker 误订阅 API-only Socket.IO relay 的缺陷，已以失败回归测试驱动修复并在真实 worker 验证，修复提交为 `e83d153`。
- 隔离 schema、4 个用户、3 个 Space、4 个 Agent、进程、Redis 临时键与隔离 HOME/config 已全部清理并二次确认。
- 本地实现已验证；push、npm 发布和生产发布未获授权，未执行。
- 上一版协作发布基线仍为本地/GitHub/生产 `0.6.1` 与 Sync Protocol `0.3.0`。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；人工审核只能由人类完成；指定审核人失效时只允许 Owner/Admin 走审计恢复通道。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- Sync Protocol 独立 semver；当前修订发布顺序必须是 protocol `0.3.0` → registry 验证 → local-sync `0.6.1` → 弃用损坏的 `0.6.0`。
- Obsidian 连接从“使用指南”内部进入；全局导航与个人菜单不再提供独立“连接 Obsidian”目的地，`/guide` 在 Obsidian 子路由上保持激活。

# 关键索引

- 当前 Agent 准备设计：`agentwiki/docs/superpowers/specs/2026-08-25-collaboration-agent-preparation-design.md`
- 当前 Agent 准备计划：`agentwiki/docs/superpowers/plans/2026-08-25-collaboration-agent-preparation-plan.md`
- 本地最终验收：`agentwiki/docs/testing/collaboration-agent-preparation-acceptance.md`
- 当前活跃任务：`.codex-memory/tasks/active/collaboration-agent-preparation/`
- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板实施计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 最终发行审查计划：`docs/superpowers/plans/2026-08-24-collaboration-release-final-audit.md`
- 真实客户端与最终门禁：`agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- 已归档协作任务：`.codex-memory/tasks/archive/agent-collaboration-templates/`
- 已归档发布收口任务：`.codex-memory/tasks/archive/collaboration-release-finalization-2026-08-24/`
- 既有安全/发布任务：`.codex-memory/tasks/archive/comprehensive-security-reliability-audit-2026-08-23/`

# 风险 / 下一步

- 待用户单独授权后，才能 push 当前分支、执行发布或生产部署；本任务因此保持 active。
- 任何生产发布都需重新完成目标确认、备份、部署门禁和在线 Browser 验收；不得把本地验收当作已发布证据。
