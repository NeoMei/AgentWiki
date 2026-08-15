<!-- codex-memory:template=current:v1 -->

# 当前目标

- 完成 AgentWiki 单一 MCP 入口修复：实现、本地验证与三轮独立评审均已完成（第三轮结论 ready to merge，Minor 项也已收口）；npm 发布、合并 `master` 和生产部署尚未执行。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核。
- 本任务只实现并验证代码；未经单独授权不发布 npm、不推送/合并、不部署生产。

# 当前状态

- 分支 `codex/unified-agentwiki-mcp-fix` 已完成 0.3.7 实现：普通 Credential 只用于 API/脚本/外部系统；已有 Agent 通过 `onboard --code` 安装或更新唯一 `agentwiki` gateway。
- gateway 继续统一暴露 `wiki_*`、`local_*`、`knowledge_*`；公开 CLI 不含 `connect`、`mcp`、`scan`、`sync` 或 `upgrade` 旧命令。
- Codex/Claude/OpenCode 配置迁移改为包签名、显式历史名称或当前服务端 `/mcp` 端点匹配；未知同名项阻断，卸载只删除本包拥有的 `agentwiki` 项。Codex TOML 普通节保留已有回归测试。
- `onboard --code` 的 NDJSON 成功/失败终态、输入流关闭、失败脱敏、安装回滚和凭据吊销均有测试；真实 CLI 子进程已验证 `preview → confirmation_required → failed` 序列且不泄漏安装码/API Key。
- 服务端 exchange 幂等改为数据库唯一认领（`AgentCredential.localSyncInstallationId` 唯一列 + 迁移 `20260815010000_add_local_sync_installation_claim`），API key 由 HMAC-SHA256(JWT_SECRET, installationId) 确定性派生；Redis receipt 只存元数据、TTL 受安装码剩余寿命约束；exchange 锁为随机 owner token + Lua compare-and-delete；重放安装码不再归档活动 `~/.agentwiki` 状态。轮换 JWT_SECRET 会使旧安装码无法重新派生 key（已安装凭据不受影响），需与签发新码一起操作。
- 最新门禁：runtime 69 pass/39 skip、server 517、client 156、sync-protocol 22、local-sync 358；typecheck、lint、build、diff check 和 0.3.7 npm tarball 检查通过。
- npm 和生产仍为 0.3.6；本分支未执行任何外部发布动作。
- 2026-08-14：Obsidian Sync v1 主项目三项交付已合并并推送 `master`，生产 `agentwiki.quukk.com` 已部署应用提交 `626af9d`；协议包、人类设备身份、`/api/sync/v1`、Release A/B 数据迁移与加固迁移全部上线。
- 生产迁移无未解决失败：Release B 曾有一次已回滚尝试，随后成功应用；Page/Revision 回填、约束、索引与服务端身份数据不变量均通过 SQL 核验。
- 线上 API smoke 18 项、UI 路由 smoke（3 public / 16 authenticated / 6 mobile）、真实公网 Sync v1 安装→exchange→activate→head→push→finalize→snapshot 全链路均通过，测试数据已清理。
- 部署前 PostgreSQL 备份：`/root/backups/agentwiki/pre-obsidian-sync-v1-20260814222116.dump`，SHA-256 `e3ad520ba8ce37ba46beac84321428b2ca2730ab51ae4bde411a1e0fa9d339d7`；`pg_restore --list` 校验通过。
- 2026-08-12：第三方黑盒测试发现的 DEF-002（Codex/Claude mcp-registration）和 DEF-003（preview diff 统计）全部修复并验证。
- DEF-003 在 0.3.3 修复（首次同步 preview 补全 added/modified/deleted/uploadBytes）。
- DEF-002 Codex 分支在 0.3.5 修复（doctor spawn runner 转发 env，隔离 HOME 真正生效）。
- DEF-002 Claude 分支在 0.3.6 修复（网关改写到 ~/.claude.json；旧 settings.json 残留清理）。
- npm latest=0.3.6；生产 agentwiki.quukk.com 已部署 0.3.6，三服务 active，健康全绿。
- RETEST4：Codex/Claude/OpenCode 三客户端 mcp-registration 全 PASS（隔离 HOME + 公网包）。
- 上一生产版本四端一致：npm、GitHub、生产服务端、onboard 文档均为 0.3.6。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地 Agent 只配置一个名为 `agentwiki` 的 stdio MCP gateway；普通 Credential 不生成 MCP 指令，远程 `/api/mcp` 只由 gateway 内部桥接。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须用户确认。
- 发布流程固定为备份、迁移、部署、健康检查、受控 smoke、三客户端 E2E 和版本核对。

# 关键索引

- 产品代码：`agentwiki/`（当前开发版本 0.3.7；生产仍为 0.3.6）
- 当前任务：`.codex-memory/tasks/active/unified-agentwiki-mcp-fix/brief.md`
- 修复设计：`agentwiki/docs/superpowers/specs/2026-08-15-unified-agentwiki-mcp-entry-fix-design.md`
- 实施计划：`agentwiki/docs/superpowers/plans/2026-08-15-unified-agentwiki-mcp-entry-fix-plan.md`
- 本地验证：`agentwiki/docs/verification/unified-agentwiki-mcp-0.3.7.md`
- 第三方测试验证报告：`agentwiki/docs/verification/third-party-onboarding-0.3.6.md`
- 设计：`agentwiki/docs/superpowers/specs/2026-08-10-agent-self-service-onboarding-gateway-design.md`
- 已完成计划：`agentwiki/docs/superpowers/plans/2026-08-10-agent-self-service-onboarding-gateway-plan.md`
- 验证报告：`agentwiki/docs/verification/agent-self-service-onboarding-0.3.1.md`
- 生产：https://agentwiki.quukk.com
- 生产部署目标：`root@113.249.120.24`，应用在 `/root/agentwiki`，user-systemd + linger；`SSHPASS=... bash deploy.sh 113.249.120.24 root`
- 部署前备份：`pg_dump` custom format 到 `~/backups/agentwiki/`，并用 `pg_restore --list` 与 SHA-256 校验。
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync

# 风险 / 下一步

- 评审已收口（ready to merge）。后续由用户单独决定 npm 0.3.7 发布、分支推送/合并和生产备份部署。
- 生产验收必须重新验证生成指令、三客户端单一 `agentwiki` 配置、gateway 工具清单与 Credential 面板；本地验证不能替代公网发布包和生产 E2E。
- 仅余 NestJS SSE 序列化中危告警 `GHSA-36xv-jgw5-4q75`；项目没有 SSE 路由或 `SseStream` 使用，当前不可达。后续单独规划 NestJS 10→11 大版本升级，不在 0.3.1 补丁发布中冒险处理。
- 前端 `PageEditor` 构建 chunk 约 710 kB，属于性能优化候选，不阻塞本次功能与安全发布。
- Sync v1 Release B 已将旧 snapshot/delta JSON 列改为 nullable；不得回滚到不支持规范化 rows/sidecar 的旧服务端二进制，回滚必须走兼容迁移或前滚修复。
