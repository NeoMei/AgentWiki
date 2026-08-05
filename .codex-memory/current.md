<!-- codex-memory:template=current:v1 -->

# 当前目标

- 已完成服务端 OpenCode 模型自动降级与成本路由：免费模型优先、付费模型自动发现与成本排序、Redis 共享熔断和 token/cost 记录。已合并 master，部署生产。
- 已完成平台超管管理后台：用户与核心资源统计、用户查询、默认密码重置与强制改密码、锁定/解锁和软删除。已合并 master，部署生产。
- 待完成：跨机器 Snapshot/Delta Pull/Push 与冲突合并真实验收（local-knowledge-sync 最后阶段）。
- 待完成：space-add-agent-member 浏览器视觉验收（Chrome 插件恢复后）。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；远端采用源码直部署和用户级 systemd，不使用 Docker 运行应用。
- 不恢复公开 Agent 注册、任意服务器本地路径摄取、旧 DocumentGeneration 双轨、Agent 直接写正式知识或 Agent 自批。
- 不宣称未经验证的四层记忆或时间衰减。

# 当前状态

- 2026-08-06 完成 OpenCode 模型降级合并部署：11 commits，29 files，3200+ 行，免费优先 + 付费自动发现 + Redis 熔断 + 成本记录，全仓门禁通过，生产运行正常。
- 2026-08-06 完成平台超管管理后台：Prisma 迁移（lockedAt/mustChangePassword/authVersion），PlatformAdminModule（Guard/统计/用户管理/密码重置/锁定解锁/软删除），JWT/PAT/Agent 凭据同步校验，前端 /admin 页面。全部合并 master，部署生产，超管账号 admin@agentwiki.com 已配置。
- 门禁（2026-08-06）：服务端 42 suites / 343 tests、客户端 30 files / 124 tests、local-sync 22 files / 160 tests、typecheck 0、lint 0、build 0。
- P7 三个缺口已确认全部修复：review.service.ts 写入 spaceKnowledgeRevision、getSubmission 完整实现、LOCAL_SYNC_VERSION=0.2.2。
- @neomei/agentwiki-local-sync@0.2.2 已发布 npm latest。
- 生产公网 https://agentwiki.quukk.com 运行正常，API/Worker/Frontend 全部健康。
- GitHub master 已推送最新代码（cc94047）。

# 稳定约束

- Agent 是人类拥有的独立实体；权限为当前 Credential Scope、Space Grant、Agent 状态和 Space 策略的交集。
- 平台超管是 human User 的独立 platformRole，作为 owner 等效入口接入既有 Space 授权链。
- JWT 包含 authVersion，每次验证从数据库刷新；锁定/删除/版本不匹配时认证失败。
- 超管不可自操作；锁定/删除最后超管受服务端保护。
- Markdown 编辑器不得恢复为并排双栏；界面新增文案同时提供中英文。
- 本地知识同步不得上传原始代码库/二进制文档/凭据。
- 正常安装和调用保持一个接入指令与自然语言入口。

# 关键索引

- 产品代码：`agentwiki/`
- 生产地址：https://agentwiki.quukk.com
- GitHub：https://github.com/NeoMei/AgentWiki
- npm 包：https://www.npmjs.com/package/@neomei/agentwiki-local-sync
- 超管账号：admin@agentwiki.com

# 风险 / 下一步

- space-add-agent-member 浏览器视觉验收仍待 Chrome 插件恢复后补跑。
- local-knowledge-sync 跨机器双向同步真实验收待继续。
- 后续发布继续执行备份 → 直部署 → /api/health → 业务 smoke。
