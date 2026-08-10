<!-- codex-memory:template=current:v1 -->

# 当前目标

- 推进 Agent 自助接入 0.3.0：网页 Device Auth、NDJSON 填空、单一 gateway MCP，以及首次本地扫描和同步。Task 5-9(核心)已完成代码实现，Task 9 剩余(CLI 重写/verifier)与 Task 10-11(版本/文档/E2E)待继续。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核；只有明确授权且符合 Space 策略的普通写操作可自动发布。

# 当前状态

- 2026-08-11 在 codex/production-readiness worktree 完成 0.3.0 onboarding Task 5-9(核心)，6 个提交：
  - Task 5: NDJSON 协议(Zod discriminated unions)、onboarding HTTP 客户端(device start/poll/bootstrap)、安全 session 持久化(0600/0700/原子写)、稳定错误码、awd_/awo_/awu_ 脱敏
  - Task 6: 单一 gateway manifest(6 工具 + legacy 黑名单 + 确定性 hash)、RemoteMcpBridge(代理 /api/mcp + 离线缓存)、createGatewayServer(确定性平面绑定)
  - Task 7: KnowledgeWorkflows(prepare 零网络/confirmAndSync pull-before-push/conflict 阻断/pull)
  - Task 8: 原子安装器(gateway 命令 pin 0.3.0、Codex/Claude/OpenCode 配置、备份/回滚/并发 hash 冲突、旧 ~/.agentwiki 归档)
  - Task 9(核心): OnboardingCoordinator 完整状态机(collecting→...→completed，checkpoint resume，失败稳定错误码)
- local-sync 门禁：34 文件 / 271 测试全通过；typecheck 0；lint 0。
- 旧双 MCP 工厂(createLocalSyncMcpServer/createOrchestratorMcpServer)保留在 mcp.ts，待 Task 9 CLI 重写时删除。
- master 工作区有过时 0.2.4 改动已 stash(obsolete-0.2.4-orchestrator-work-superseded-by-branch)。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成，只同步确认后的知识 Bundle。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须生成提案并由用户确认，禁止静默覆盖。
- Markdown 编辑器保持单界面阅读/实时预览编辑状态，不恢复并排双栏。
- 发布流程固定为备份、迁移、部署、健康检查、受控 smoke 和版本核对。

# 关键索引

- 产品代码：`agentwiki/`
- 工作目录：`agentwiki/.worktrees/production-readiness/`(分支 codex/production-readiness)
- 生产地址：https://agentwiki.quukk.com
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync
- 测试报告：`agentwiki/docs/verification/production-readiness-0.2.9.md`
- 0.3.0 onboarding 新代码：`packages/local-sync/src/{onboarding,gateway,installer}/`

# 风险 / 下一步

- Task 9 剩余：创建 preflight.ts、verifier.ts(gateway 子进程 MCP handshake 验证)、CLI 重写(onboard/resume/doctor/uninstall/gateway)、删除旧双 MCP 工厂。
- Task 10：版本升 0.3.0、README/SKILL/UsageGuide/onboard.json 更新、runtime contract 测试。
- Task 11：onboarding-e2e.mjs + 浏览器 E2E + 三客户端安装 + 生产受控 E2E + 验证报告。
- codex/production-readiness 分支领先 master 26 个提交，尚未合并；本地比 GitHub 远程多 12 个提交(含本次 6 个)未 push。
- master 远程比本地多 11 个提交(需对齐)。
