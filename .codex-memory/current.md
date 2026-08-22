<!-- codex-memory:template=current:v1 -->

# 当前目标

- 完成 Agent `reader`、`editor`、`publisher` 统一访问角色的发布门禁。
- 关闭最终广度审查的 Reader onboarding、Agent Grant 双门槛和 auto-publish TOCTOU 三项 Important。

# 范围 / 不做

- 本地实现和验证覆盖统一角色策略、Grant/Credential 角色、连接授权包、原子兑换、Agent 访问页、本地同步 0.5.0 协议与 MCP 回归。
- 不兼容旧 `viewer` / `full` / 自定义 scopes 客户端或旧版本权限数据。
- Agent 不获得人工审批、成员管理或 `review:decide`。Publisher 不自动修改 Space Policy。
- 未经单独授权不 push、发布 npm、部署生产或执行真实 OpenCode 验收。

# 当前状态

- 分支 `codex/unified-agent-access-roles` 已完成三项审查修复：`23c2a9a` Reader 只读收尾、`bf888da` Agent owner + Space admin 双门槛、`b735112` 发布临界点当前状态重验。
- Reader 路径 127 个相关测试、Space/Agent 双门槛 server 28 + client 6 个测试、Review/MCP/background 136 个相关测试及完整 server 64 suites / 761 tests 通过。
- 最终全仓门禁通过：runtime 84 通过 / 47 显式环境跳过，server 64 suites / 761 tests、client 45 files / 224 tests、sync-protocol 25 tests、local-sync 59 files / 732 tests；build、typecheck、lint、Prisma generate/validate、三客户端 onboarding 8+8 均为 exit 0。
- sync-protocol 0.2.0 / local-sync 0.5.0 两个候选包已重新联合打包并通过空目录安装和 CLI 启动；local-sync 包为 151 项、147712 bytes，SHA-256 `451435b9e9ac28fcfa8412a691ff5e1d75063a856a1099a51ae50b987885a2cd`。
- 外部基线仍为 `origin/master=c06b9b8`、npm sync-protocol 0.1.0 / local-sync 0.4.0、生产 onboarding 0.4.0；本地、GitHub、npm 和生产尚未对齐。

# 稳定约束

- Agent 有效权限始终为 Credential、Space Grant、Agent/owner 状态、Space Policy 和领域约束的交集。
- `review:decide` 仅属于人类审批领域，不签发给 Agent。
- 服务端是角色到 scopes 的唯一权威；普通客户端不得自定义或扩展 scopes。
- Credential 与 Grant 必须原子生效；连接码未兑换、过期或失败不得留下半套授权。
- Reader onboarding 不得进入写同步路径；Agent Grant 变更同时要求 Agent owner 和 Space owner/admin。
- Agent auto-publish 必须在发布事务临界点锁定并重读 Credential、Agent/owner、Grant 和 Space；任一门槛失效时回到 `pending_review`。

# 关键索引

- 活跃任务：`.codex-memory/tasks/active/unified-agent-access-roles/brief.md`
- 设计：`agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`
- 计划：`agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`
- 本地验证：`agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- 部署门禁：`agentwiki/docs/operations/unified-agent-access-roles-0.5.0-deployment.md`
- Reader 只读协调：`agentwiki/packages/local-sync/src/onboarding/coordinator.ts`
- Agent Grant 可管理事实：`agentwiki/apps/server/src/core/space/space.service.ts`
- Auto-publish 最终重验：`agentwiki/apps/server/src/review/review.service.ts`

# 风险 / 下一步

- 等待最终 reviewer 对三项 Important 修复复审。
- 复审通过后仍需用户单独授权 push、npm 发布、生产部署和真实 OpenCode 验收；部署前须先验证 PostgreSQL custom-format 与应用回滚备份。
- 0.5.0 不兼容旧协议，无 schema-only 回滚；回退必须成对恢复数据库与应用备份。
