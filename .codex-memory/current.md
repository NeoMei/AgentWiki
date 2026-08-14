<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 自助接入 0.3.1 已实现、测试、发布并完成生产验收；当前无活跃开发任务。
Agent 自助接入 0.3.6 已实现、测试、发布并完成生产验收；第三方测试缺陷 DEF-002/003 全部修复并通过 RETEST4；当前无活跃开发任务。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核。

# 当前状态

- 2026-08-14：Obsidian Sync v1 主项目三项交付已在分支 `codex/obsidian-sync-v1` 完成并推送；已创建 draft PR https://github.com/NeoMei/AgentWiki/pull/5，未合并 master、未发布生产。
- 2026-08-12：第三方黑盒测试发现的 DEF-002（Codex/Claude mcp-registration）和 DEF-003（preview diff 统计）全部修复并验证。
- DEF-003 在 0.3.3 修复（首次同步 preview 补全 added/modified/deleted/uploadBytes）。
- DEF-002 Codex 分支在 0.3.5 修复（doctor spawn runner 转发 env，隔离 HOME 真正生效）。
- DEF-002 Claude 分支在 0.3.6 修复（网关改写到 ~/.claude.json；旧 settings.json 残留清理）。
- npm latest=0.3.6；生产 agentwiki.quukk.com 已部署 0.3.6，三服务 active，健康全绿。
- RETEST4：Codex/Claude/OpenCode 三客户端 mcp-registration 全 PASS（隔离 HOME + 公网包）。
- 门禁：runtime 67/9 skip、server 486、client 160、local-sync 328；typecheck/lint/build 通过。
- 四端版本一致：npm、GitHub、生产服务端、onboard 文档均为 0.3.6。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须用户确认。
- 发布流程固定为备份、迁移、部署、健康检查、受控 smoke、三客户端 E2E 和版本核对。

# 关键索引

- 产品代码：`agentwiki/`（版本 0.3.1）
- 第三方测试验证报告：`agentwiki/docs/verification/third-party-onboarding-0.3.6.md`
- 设计：`agentwiki/docs/superpowers/specs/2026-08-10-agent-self-service-onboarding-gateway-design.md`
- 已完成计划：`agentwiki/docs/superpowers/plans/2026-08-10-agent-self-service-onboarding-gateway-plan.md`
- 验证报告：`agentwiki/docs/verification/agent-self-service-onboarding-0.3.1.md`
- 生产：https://agentwiki.quukk.com
- 生产部署目标：`root@113.249.120.24`，应用在 `/root/agentwiki`，user-systemd + linger；`SSHPASS=... bash deploy.sh 113.249.120.24 root`
- 部署前备份：`pg_dump | gzip > ~/backups/agentwiki/pre-<version>-<ts>.dump.gz`
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync

# 风险 / 下一步

- 仅余 NestJS SSE 序列化中危告警 `GHSA-36xv-jgw5-4q75`；项目没有 SSE 路由或 `SseStream` 使用，当前不可达。后续单独规划 NestJS 10→11 大版本升级，不在 0.3.1 补丁发布中冒险处理。
- 前端 `PageEditor` 构建 chunk 约 710 kB，属于性能优化候选，不阻塞本次功能与安全发布。
