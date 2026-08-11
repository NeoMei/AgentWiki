<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 自助接入 0.3.1 已实现、测试、发布并完成生产验收；当前无活跃开发任务。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核。

# 当前状态

- 2026-08-11：2026-08-10 Agent 自助接入设计与 11 个实施 Task 全部完成，计划清单已全部勾选并归档。
- npm `@neomei/agentwiki-local-sync@0.3.1` 已发布，`latest=0.3.1`；纯 Markdown/TXT 首次扫描不再等待 MarkItDown Python runtime，PDF/DOC/DOCX 仍按需安装。
- 生产 `https://agentwiki.quukk.com` 已部署 0.3.1；API、worker、frontend 均 active，健康检查 database/Redis/audit persistence 全绿，`/api/onboard.json` 实际返回 HTTP 410。
- Codex、Claude Code、OpenCode 已分别用 npm 公网包在隔离 HOME 完整通过 Device Auth、bootstrap、单一 gateway、扫描、预览、同步和清理；生产残留 0 用户 / 0 Space。
- Playwright 生产 Device Auth UI E2E 通过。
- 最终门禁：runtime 67 pass/9 skip、server 486、client 160、local-sync 317；typecheck/lint/build 通过；peer 0；audit 0 high/critical。
- GitHub PR #4 已用于集成，发布标签与 Release 为 `v0.3.1`。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须用户确认。
- 发布流程固定为备份、迁移、部署、健康检查、受控 smoke、三客户端 E2E 和版本核对。

# 关键索引

- 产品代码：`agentwiki/`（版本 0.3.1）
- 设计：`agentwiki/docs/superpowers/specs/2026-08-10-agent-self-service-onboarding-gateway-design.md`
- 已完成计划：`agentwiki/docs/superpowers/plans/2026-08-10-agent-self-service-onboarding-gateway-plan.md`
- 验证报告：`agentwiki/docs/verification/agent-self-service-onboarding-0.3.1.md`
- 生产：https://agentwiki.quukk.com
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync

# 风险 / 下一步

- 仅余 NestJS SSE 序列化中危告警 `GHSA-36xv-jgw5-4q75`；项目没有 SSE 路由或 `SseStream` 使用，当前不可达。后续单独规划 NestJS 10→11 大版本升级，不在 0.3.1 补丁发布中冒险处理。
- 前端 `PageEditor` 构建 chunk 约 710 kB，属于性能优化候选，不阻塞本次功能与安全发布。
