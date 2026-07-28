<!-- codex-memory:template=current:v1 -->

# 当前目标

- 最终整分支审查整改已于 2026-07-27 完成并通过终审；当前无活跃开发任务，可直接接收新任务。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；远端采用源码直部署和用户级 systemd，不使用 Docker 运行应用。
- 不恢复公开 Agent 注册、任意服务器本地路径摄取、旧 DocumentGeneration 双轨、Agent 直接写正式知识或 Agent 自批。
- 不宣称未经验证的四层记忆或时间衰减。

# 当前状态

- P0-P6 安全、Agent、Source/Run、ChangeSet/Review、来源证据、Memory、MCP 和界面入口差异均已闭环。
- Markdown 编辑页使用单一工作区，以 Edit/Preview 状态切换和 `Ctrl/⌘ + E` 快捷键替代双栏；桌面与移动端均已验证。
- 全局语言上下文支持中文/英文切换、浏览器持久化和 `html lang` 同步；导航、认证、空间、页面、Agent、来源/运行、审核、图谱、成员、Profile、集成、产品页和指南均已接入。
- 远端 PostgreSQL 18.4 已在可恢复备份后部署全部迁移，当前 13/13，无待执行迁移。
- 远端直接运行 `agentwiki-api.service`、`agentwiki-worker.service`、`agentwiki-frontend.service`；三项均为 active，Docker 服务为 inactive。
- `/api/health` 验证 PostgreSQL 与 Redis；远端业务 smoke 完成注册、Space、Page、Search、Agent Credential/Grant、MCP 只读及审计、Source → Run → Review → Publish → provenance，临时数据已删除。
- 当前门禁：ESLint、双端类型检查、16 个 Jest 套件 58 项服务端测试、4 项 Vitest 客户端测试、Nest/Vite 生产构建全部通过。端到端功能测试 R1-R4 已完成（注册、Space、Page CRUD、搜索、图谱、Agent/API Key、Source→Run→Review 全链路、MCP、权限隔离、输入验证、并发更新、大 payload 返回 413 而非 500）均已通过。R4-R5 完成全量深度代码审查和 E2E 测试。修复：Space DTO name MinLength(1) 验证、ESLint 配置忽略 *.config.js、SourcesPage 加载状态指示器。所有门禁通过。远端已验证结构化业务错误码（12 个 code）和 ChangeSet submit 端点正常工作。
- 本机仅以 Node 26.5.0 + pnpm 11.9.0 作为 AgentWiki 运行时；PostgreSQL 16 与 Redis 已作为用户服务启动，本地 `agentwiki` 数据库已应用 13/13 迁移。
- `pnpm dev` 现由 Node 启动器统一加载 `.env`、映射 `APP_SECRET`/`JWT_SECRET`、监督 API/Worker/Vite 并转发退出信号；Vite 前端 `http://localhost:5173` 返回 200，Nest API `http://localhost:3000/api/health` 返回 database/redis 均为 ok，Worker 正常连接 Redis。
- 2026-07-27 fresh Node 26 门禁：`test:runtime` 7/7、ESLint 0 error/10 warnings、双端类型检查、Jest 16 suites/58 tests、Vitest 4 files/4 tests、shared/Nest/Vite 生产构建均退出 0；中间任务和源码 TODO 扫描均无匹配。
- codebase-memory 规范项目名为 `agentwiki`，主产品 `agentwiki/` 已纳入 `codex/node26-compatibility` 版本控制；规范图为 1565 nodes / 3624 edges，`node_modules`、`dist`、`.stale-node-modules` 和参考仓库路径污染均为 0，Authorization/Review/Memory/Mcp 四项服务各发现 1 个定义。
- 最终审查整改 `final-review-remediation` 已完成：后端安全（回滚版本条件、认证限流、审计持久化、Compose healthcheck、Redis ACL fail-closed）经独立复审 Approved；旧数据与凭据（PAT 前向清除、Memory 哈希 ASCII-only 规范化、13/13→17/17 桥接迁移、provenance 可信校验、Evidence 幂等身份）经独立复审 Approved；前端（编辑器草稿保护、Review 详情新鲜度、E2E 仅 loopback + 显式 opt-in、服务端乐观锁 `expectedUpdatedAt`）已落地。
- 2026-07-27 最终门禁：服务端 21 suites/111 tests、客户端 8 files/37 tests、双端 tsc、Nest/Vite 构建、ESLint 0 error/0 warning（scripts 与 spec 已声明 Node globals）、真实 PostgreSQL 乐观锁往返（正确 token=1 / 过期=0）全部通过；迁移 17/17。
- 2026-07-28 使用指南已补全为六步通用 Agent 接入流程，明确 AgentWiki 不绑定具体客户端，Codex、Claude Code、OpenCode 等本地 Agent 使用同一套服务端接入方式；OpenCode 1.18.7 仅作为真实演示，已完成 MCP initialize、身份校验、`list_spaces`、`propose_page`、`list_pages`。演示页面以 `scoped-auto-publish` 正式发布，OpenCode 结果、页面来源与 MCP 活动记录均使用真实截图。重复接入时改用凭据专属 MCP 连接名并强制校验服务端 Agent 身份，避免误用旧连接；临时凭据已撤销且验证返回 401。客户端门禁为 19 files / 86 tests、ESLint、TypeScript/Vite 构建全部通过。
- 唯一外部阻塞：真实 pre-migration 备份库与 `LEGACY_DATABASE_URL` 未提供，真实历史库 recovery dry-run/apply 未执行；这是部署前外部验证门禁，不构成当前代码缺陷。

# 稳定约束

- Agent 是人类拥有的独立实体；权限为当前 Credential Scope、Space Grant、Agent 状态和 Space 策略的交集。`review:decide` 不签发给 Agent。
- JWT 与 WebSocket 握手必须重新确认当前未删除的人类 User；正式知识必须保留 Source/Version/Run/Evidence/ChangeSet/Approval provenance。
- 自动知识默认进入 ChangeSet；Worker 使用可续租 fenced lease，在多个阶段复核凭证与授权。
- 记忆只声明 episodic/semantic；private 仅目标 Agent，space 可由同 Space 授权 Agent 召回。
- 远端发布必须先备份，再执行迁移和业务 smoke；应用保持直部署并由三个用户级 systemd 服务管理。
- Markdown 编辑器不得恢复为并排双栏；编辑与预览使用同一工作区状态切换。界面新增用户可见文案时必须同时提供中文和英文，并保持语言选择持久化。

# 关键索引

- 产品代码：`agentwiki/`
- 当前设计：`design/CURRENT_DESIGN.md`
- 全量整改与发布记录：`design/REMEDIATION_TODO.md`
- 运维与备份：`design/OPERATIONS.md`
- systemd 单元：`agentwiki/deploy/systemd/`
- 直部署脚本：`agentwiki/deploy.sh`
- 本机代码图谱：`agentwiki/.codebase-memory/graph.db.zst`
- 本机开发配置：`agentwiki/.env`、`agentwiki/apps/server/.env`（数据库主机已切到 `127.0.0.1`）
- 运行时约束：`agentwiki/.node-version`、`agentwiki/package.json`、`agentwiki/scripts/node26-contract.test.mjs`
- 本机 Git 元数据：`/Users/neomei/.local/share/AgentWiki.git`（工作树仍为当前项目路径，避免 iCloud 占位对象阻塞 Git）
- 迁移前备份：`C:\Users\1\AgentWikiBackups\agentwiki-pre-migrate-20260716-003650.dump`

# 风险 / 下一步

- 当前无活跃任务或代码缺陷阻塞。部署前需用户提供真实 pre-migration 备份并配置 `LEGACY_DATABASE_URL` 完成真实历史库 recovery dry-run/apply。
- 当前 codebase-memory-mcp 的 `--name agentwiki` 参数仍会被 CLI/MCP 忽略；图工件已通过完整性校验并规范化为 `agentwiki`。工具升级后应移除该手工规范化步骤并以官方参数重新索引验证。
- 后续发布继续执行备份 → 直部署 → `/api/health` → 业务 smoke；监控 systemd/journal、Worker 租约和备份保留。
- 记忆时间衰减或新增层级前，必须完成至少 50 个生产影子查询评审并保持 Recall@3/MRR 门槛。
