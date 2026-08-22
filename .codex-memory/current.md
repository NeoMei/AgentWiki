<!-- codex-memory:template=current:v1 -->

# 当前目标

- 将 Agent 的 Space Grant、连接码授权和 Credential 授权合并为一次角色选择。
- 新模型统一使用 `reader`、`editor`、`publisher`，修复 editor Agent 因连接凭证缺少 `pages:write` 而无法提议页面修改的问题。

# 范围 / 不做

- 范围包括统一角色策略、Grant/Credential 角色、连接授权包、原子兑换、Agent 访问页、本地同步协议、MCP 回归与真实 OpenCode 验收。
- 不兼容旧 `viewer` / `full` / 自定义 scopes 客户端或旧版本权限数据。
- Agent 不获得人工审批、成员管理或 `review:decide`。
- Publisher 不自动修改 Space Policy。
- 未经单独授权不 push、发布 npm 或部署生产。

# 当前状态

- 已复现并定位根因：`LocalSyncInstallCard` 的固定连接 scopes 包含 `pages:read` 但缺少 `pages:write`，同时 Grant、连接码和手工 Credential 是三套分离设置。
- 用户已选定连接授权包方案，并确认 `reader`、`editor`、`publisher` 三个角色。
- 权限矩阵、原子兑换、多 Space/多 Credential 交集、界面、安全、失败处理和真实 OpenCode 验收设计均已确认。
- 设计文档位于 `agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`，实施计划位于 `agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`；生产代码尚未修改。
- 新协议计划版本为 0.5.0，只接受三档新角色；数据库迁移不推断旧 scopes，现有 Agent Grant/Credential 统一安全降级为 reader，重新连接后再获得新角色。
- 上一阶段 CodeGraph/local-sync 0.4.0 已发布、GitHub 与生产部署已完成；本任务尚未改变该已发布状态。

# 稳定约束

- Agent 有效权限始终为 Credential、Space Grant、Agent 状态、Space Policy 和领域约束的交集。
- `review:decide` 仅属于人类审批领域，不签发给 Agent。
- 同一 Agent 可在不同 Space、不同 Credential 上拥有不同能力上限。
- 服务端是角色到 scopes 的唯一权威；普通客户端不得自定义或扩展 scopes。
- Credential 与 Grant 必须原子生效；连接码未兑换、过期或失败不得留下半套授权。

# 关键索引

- 活跃任务：`.codex-memory/tasks/active/unified-agent-access-roles/brief.md`
- 设计：`agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`
- 计划：`agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`
- Agent 页面：`agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- 当前连接卡片：`agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Agent 服务：`agentwiki/apps/server/src/core/agent/agent.service.ts`
- 连接兑换：`agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts`
- 权限交集：`agentwiki/apps/server/src/core/authorization/authorization.service.ts`

# 风险 / 下一步

- 设计已复核，逐步 TDD 实施计划已编写；等待用户选择执行方式。
- 实现需要同步修改服务端、数据库、前端、sync-protocol、local-sync、onboarding 与 MCP 验收，避免只修界面再次产生权限漂移。
