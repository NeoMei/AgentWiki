<!-- codex-memory:template=current:v1 -->

# 当前目标

- 修复 Agent 协作运行“映射 Agent”无可选项且无法就地创建/接入的问题，使有权限的用户能在同一向导完成 Agent 准备与映射。

# 范围 / 不做

- 范围包含已有/新建 Agent、paused 恢复、当前 Space Editor/Publisher 授权、MCP 一次性接入指令、接入检测和当前 Role Slot 自动选择。
- 不自动启动外部 Agent，不修改协作调度/模板/状态机，不批量映射全部角色。
- 继续复用 `AgentGrant.role` 单一权限事实；Agent 不获得人类审核权限，不引入第二套 Credential scopes 或授权入口。
- 未经独立授权不推送、不发布 npm、不部署生产。

# 当前状态

- 已在生产只读复现：当前 Space 有一个 active Reader Agent 和两个 paused Agent；运行向导只展示 active 且 Grant 为 Editor/Publisher 的 Agent，因此映射列表为空。
- 根因是既有设计只提供无 Agent 提示，没有在向导内串联创建/恢复、Grant 和 MCP 接入。
- 用户已选择完整接入方案并确认交互、数据权限、组件错误处理和验收边界。
- 正式设计已写入；当前等待用户书面复核，尚未进入实施计划或修改生产代码。
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
- 当前活跃任务：`.codex-memory/tasks/active/collaboration-agent-preparation/`
- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板实施计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 最终发行审查计划：`docs/superpowers/plans/2026-08-24-collaboration-release-final-audit.md`
- 真实客户端与最终门禁：`agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- 已归档协作任务：`.codex-memory/tasks/archive/agent-collaboration-templates/`
- 已归档发布收口任务：`.codex-memory/tasks/archive/collaboration-release-finalization-2026-08-24/`
- 既有安全/发布任务：`.codex-memory/tasks/archive/comprehensive-security-reliability-audit-2026-08-23/`

# 风险 / 下一步

- 需要在计划中严格处理前端多阶段编排的部分成功、权限变化、安装码过期和陈旧响应。
- 用户复核设计文档后，使用 writing-plans 形成 TDD 实施计划。
- 生产发布仍需单独授权，并必须重新完成备份、部署和在线验收。
