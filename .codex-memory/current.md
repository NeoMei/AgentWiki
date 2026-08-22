<!-- codex-memory:template=current:v1 -->

# 当前目标

- 完成 Agent `reader`、`editor`、`publisher` 统一访问角色的发布门禁。
- 等待用户单独授权 push、npm 0.5.0 发布、生产部署与真实 OpenCode 验收。

# 范围 / 不做

- 本地实现和验证已覆盖统一角色策略、Grant/Credential 角色、连接授权包、原子兑换、Agent 访问页、本地同步 0.5.0 协议与 MCP 回归。
- 不兼容旧 `viewer` / `full` / 自定义 scopes 客户端或旧版本权限数据。
- Agent 不获得人工审批、成员管理或 `review:decide`。
- Publisher 不自动修改 Space Policy。
- 未经单独授权不 push、发布 npm 或部署生产。

# 当前状态

- 本地分支 `codex/unified-agent-access-roles` 已完成生产代码、界面、协议、文档和迁移实现；应用候选提交为 `92750fa3d29a40a184556c07a50d4edf9dfb3e3e`。
- 提交态 `pnpm build && pnpm test` 全绿：runtime 81 通过 / 47 显式环境跳过，server 737、client 223、sync-protocol 25、local-sync 731 通过。
- typecheck、lint、Prisma generate/validate、三客户端 onboarding 8+8、迁移静态检查、diff 和秘密扫描均通过。
- 0.5.0 tarball 共 151 项、147424 bytes，SHA-256 为 `80942db782ef87f2254b1969cbe983c52e666ec4b41c806a83181d9dc9312377`。
- 读取检查显示 `origin/master=c06b9b8`、npm latest=0.4.0、生产 onboarding=0.4.0；本地、GitHub、npm 和生产尚未对齐。

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
- 本地验证：`agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- 部署门禁：`agentwiki/docs/operations/unified-agent-access-roles-0.5.0-deployment.md`
- Agent 页面：`agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- 当前连接卡片：`agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- Agent 服务：`agentwiki/apps/server/src/core/agent/agent.service.ts`
- 连接兑换：`agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts`
- 权限交集：`agentwiki/apps/server/src/core/authorization/authorization.service.ts`

# 风险 / 下一步

- 生产 commit 无法通过当前 SSH 只读访问确认，但公网 health 正常且 onboarding 明确为 0.4.0。
- 等待单独授权后，先创建并验证 PostgreSQL custom-format 和应用回滚备份，再 push、发布 npm、部署和执行真实 OpenCode Editor 验收。
- 0.5.0 不兼容旧协议，无 schema-only 回滚；回退必须成对恢复数据库与应用备份。
