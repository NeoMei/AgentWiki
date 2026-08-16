<!-- codex-memory:template=current:v1 -->

# 当前目标

- 完成 AgentWiki 单一 MCP 入口修复并全面发布上线（详见下文状态）。
- 使用指南整合已上线：使用指南、详细文档、Agent 自助接入合并为单一 `/guide` 文档式页面，左侧目录分「快速上手」（快速开始 / Agent 自助接入 / Obsidian 插件）与「详细文档」（五个章节）；新增 Obsidian 插件安装说明，链接社区列表页与 GitHub 仓库，并提供站内设备管理入口。
- 知识图谱自动生成已上线：三层方案（wiki-link 提取 origin=auto_wikilink、embedding 相似度 origin=auto_similar、LLM 语义提案走 ChangeSet 审核 origin=auto_llm），含 SpaceGraphState 设置表、手动刷新 API、worker 定时扫描、发布后增量钩子、图谱 origin 过滤/徽标与空间设置卡片。

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
- 2026-08-15 生产部署 0.3.7：部署前备份 `/root/backups/agentwiki/pre-unified-mcp-0.3.7-20260815160411.dump`（SHA-256 `6dafe895915aae8b8e148b367e9b969af5953d3f4512f23d096f745909533885`，`pg_restore --list` 通过）；`prisma migrate status` 33 个迁移全部应用，`AgentCredential.localSyncInstallationId` 列与唯一索引核验存在；三服务 active，公网 health 200，API smoke 18 项、UI 路由 smoke 3 public/16 auth/6 mobile 全部通过。
- 2026-08-15 npm 发布 0.3.7 完成：`npm view` 确认 latest=0.3.7，shasum `4a630fe688e7dd82dc726580e472342b12cde4e2` 与本地构建一致。
- 2026-08-15 三客户端公网 E2E（npm 公网包 0.3.7 + 生产 agentwiki.quukk.com + 隔离 HOME）：codex PASS（54s）、claude PASS（53s）、opencode PASS（58s），fixture 已自动清理。
- 2026-08-16 使用指南整合上线：提交 `fcf5f9c` 合并 `master`；旧路由 `/onboard`、`/docs*` 重定向进 `/guide/*` 子页，`/onboard/device` 保持不变，顶部导航移除独立自助接入入口。部署时发现 Obsidian 插件 PR 漏更新 `pnpm-lock.yaml`（`apps/obsidian-plugin` 缺失 importer，`--frozen-lockfile` 拒绝安装），补提交 `a1c0bbc` 修复后部署成功。生产三服务 active，公网 health 200，API smoke 18 项通过，UI 路由 smoke 5 public / 16 authenticated / 6 mobile + 6 个旧路由重定向断言全部通过。部署前备份 `/root/backups/agentwiki/pre-guide-reorg-20260816181149.dump`（SHA-256 `af074a846056f5ead66782312df7bddfdcc0f30fc57f043e425a4b3a62cfd020`，`pg_restore --list` 通过）。
- 2026-08-16 指南嵌套 bug 修复：`2fa0666` 移除五个 docs 子组件内部自带的 GuideLayout（路由层已提供，此前 `/guide/docs*` 双导航/双侧边栏）。
- 2026-08-16 接入面盘点收口：`5d9aa9a` 修正使用指南第 4 步文案（0.3.7 起普通凭据只出 API Key，MCP 接入指令是独立的一次性 `onboard --code` 卡片），删除已被 smoke-test 取代的 `deep-test.mjs`、`edge-test.mjs` 临时探针。三个接入链路核验仍在用：① `/guide/agent-onboard` bootstrap 命令 → `/onboard/device/start|poll` + `OnboardDevicePage`；② Agent 详情一次性码 → `onboard --code` attach → `/integrations/local-sync/exchange`；③ Obsidian 插件 → `/integrations/obsidian/*` + `/guide/obsidian` + 集成页设备管理。`/onboard` Markdown 由包版本动态拼版，始终最新。部署后备份 `pre-guide-copy-fix-20260816185432.dump`（SHA-256 `7e3ee4a4...c953f`），UI smoke 与 health 200 通过。
- 2026-08-16 主仓移除 Obsidian 插件副本：插件按 Obsidian 社区注册要求在独立仓库 `NeoMei/agentwiki-sync` 发布并维护（已到 v0.1.3），主仓 `apps/obsidian-plugin` 快照停留在 0.1.0 且无代码引用，已连同 lockfile importer 一并移除（`95d8edd` + `fdeac81` 修正误加的未跟踪文件）。服务端设备同步 API、网页集成管理页、`/guide/obsidian` 指南均保留且不受影响。全仓 install/build/test 门禁通过，生产已同步部署（health 200、UI smoke 全过；服务器残留的插件 node_modules 已移至 `/root/obsidian-plugin-node_modules-backup`）。README 的 Obsidian 链接全部指向独立仓库与社区列表页，无需再改。
- 2026-08-16 说明/脚本/README 过时信息盘点收口（`9ae8c69`）：① `/guide/agent-onboard` 页面命令改为由 `config/localSync.ts` 常量拼接，版本升级不会再留下旧 pinned 命令（契约测试同步指向常量源头）；② 删除 `local-sync-e2e.mjs`（调用已退役的 connect/scan/sync 命令且断言旧配置路径，自统一 gateway 起就已损坏，被 `onboarding-e2e` + 包内 358 项测试覆盖）及其测试、package.json 入口；③ README 项目结构补上缺失的 `packages/`（local-sync、sync-protocol）。生产已部署，页面实测渲染 0.3.7 命令，health 200。
- 四端一致：npm latest、GitHub master、生产服务端、安装指令均为 0.3.7。
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

- 无剩余项。unified-agentwiki-mcp-fix 与使用指南整合任务均已完成，可将对应活跃任务目录归档。
- 生产验收必须重新验证生成指令、三客户端单一 `agentwiki` 配置、gateway 工具清单与 Credential 面板；本地验证不能替代公网发布包和生产 E2E。
- 仅余 NestJS SSE 序列化中危告警 `GHSA-36xv-jgw5-4q75`；项目没有 SSE 路由或 `SseStream` 使用，当前不可达。后续单独规划 NestJS 10→11 大版本升级，不在 0.3.1 补丁发布中冒险处理。
- 前端 `PageEditor` 构建 chunk 约 710 kB，属于性能优化候选，不阻塞本次功能与安全发布。
- Sync v1 Release B 已将旧 snapshot/delta JSON 列改为 nullable；不得回滚到不支持规范化 rows/sidecar 的旧服务端二进制，回滚必须走兼容迁移或前滚修复。
