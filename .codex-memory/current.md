<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 自助接入 0.3.0：Task 5-9 全部实现完成（NDJSON 协议、单一 gateway MCP、知识工作流、原子安装器、coordinator 状态机、preflight、verifier、CLI 命令）。Task 10-11（版本 0.3.0/文档/E2E/生产部署）待用户授权后执行。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核。

# 当前状态

- 2026-08-11 完成 0.3.0 onboarding Task 5-9 全部代码实现，8 个提交，35 文件 +4016 行：
  - Task 5: NDJSON 协议 + HTTP 客户端 + 安全 session + 稳定错误码 + awd_/awo_ 脱敏
  - Task 6: 单一 gateway manifest + RemoteMcpBridge + createGatewayServer
  - Task 7: KnowledgeWorkflows(prepare/confirmAndSync/pull)
  - Task 8: 原子安装器(Codex/Claude/OpenCode + 备份/回滚/归档)
  - Task 9: OnboardingCoordinator + preflight + verifier + CLI(onboard/gateway) + plan-hash(精确复刻服务端规范化)
- 全量门禁(2026-08-11)：runtime 56 pass/9 skip、server 486、client 160、local-sync 292，合计 994 项测试通过；typecheck 0；lint 0；build 0。
- 生产 https://agentwiki.quukk.com 运行 0.2.9 代码，健康检查全绿，所有现有路由正常。
- 生产尚未部署 0.3.0 onboarding 代码（Task 1-9 在 codex/production-readiness 分支，领先 master 28 个提交，未 push 未部署）。
- master 工作区有过时 0.2.4 改动已 stash。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须用户确认。
- 发布流程固定为备份、迁移、部署、健康检查、受控 smoke 和版本核对。

# 关键索引

- 产品代码：`agentwiki/`
- 工作目录：`agentwiki/.worktrees/production-readiness/`(分支 codex/production-readiness)
- 0.3.0 onboarding 新代码：`packages/local-sync/src/{onboarding,gateway,installer}/`
- 生产地址：https://agentwiki.quukk.com
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync

# 风险 / 下一步

- Task 10：版本升 0.3.0、README/SKILL/UsageGuide 更新、onboard.json 替换、runtime contract 测试更新。
- Task 11：onboarding-e2e.mjs + 浏览器 E2E + 三客户端安装验收 + 生产受控部署。
- codex/production-readiness 分支领先 master 28 个提交，未 push 未合并。
- master 远程比本地多 11 个提交（需对齐）。
- npm token 已恢复（neomei），可发布 0.3.0。
