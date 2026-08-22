# 引用

- 设计：`agentwiki/docs/superpowers/specs/2026-08-22-unified-agent-access-roles-design.md`
- 计划：`agentwiki/docs/superpowers/plans/2026-08-22-unified-agent-access-roles-plan.md`
- 当前缺陷位置：`agentwiki/apps/client/src/features/agent/LocalSyncInstallCard.tsx`
- 当前分离界面：`agentwiki/apps/client/src/features/agent/AgentDetail.tsx`
- 当前 Grant/Credential 服务：`agentwiki/apps/server/src/core/agent/agent.service.ts`
- 当前连接兑换：`agentwiki/apps/server/src/core/agent/local-sync-installation.service.ts`
- 当前权限交集：`agentwiki/apps/server/src/core/authorization/authorization.service.ts`
- 当前 onboarding 预设：`agentwiki/apps/server/src/onboard/onboard.types.ts`
- 验证证据：`agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- 部署与回滚门禁：`agentwiki/docs/operations/unified-agent-access-roles-0.5.0-deployment.md`
- 角色 DTO 边界回归：`agentwiki/apps/server/src/core/dto/agent.dto.spec.ts`
- 本地候选应用提交：`0ea45ebd75b5d864b0e907b4a6fbb3b9f91b87c9`
- 干净包安装门禁：`agentwiki/scripts/verify-local-sync-clean-install.mjs`
- 当前外部基线：`origin/master=c06b9b8`、npm sync-protocol latest=0.1.0、local-sync latest=0.4.0、生产 onboarding=0.4.0
