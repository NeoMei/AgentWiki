<!-- codex-memory:template=current:v1 -->

# 当前目标

- 以已经发布并通过生产验证的 `0.5.1` 为基线，在隔离分支 `codex/agent-collaboration-workflows` 实现 Agent 协作模板与组件。
- Agent 统一访问角色和 Obsidian 单页连接流程现已在线上运行；继续监控而不另开平行授权入口。
- 后续协作能力必须继续复用 `AgentGrant.role` 单一权限事实，不重新引入独立 Credential scopes 或第二套授权入口。

# 范围 / 不做

- 已发布范围包括 `reader`、`editor`、`publisher` 三角色，单一 `Space + role` 接入、身份型 Credential、统一网关、MCP 实时鉴权、Obsidian 专页与主导航入口。
- 本轮本地审查覆盖授权 TOCTOU、任务身份继承、WebSocket、模型工具隔离、Memory 并发/生命周期、HTTP 限流、Git 导入、Local Sync 路径边界与 Obsidian 单页连接流程。
- 不兼容旧 Agent `viewer` / `full` / 自定义 scopes 客户端或旧 Credential 数据；人类 Space 成员角色属于独立领域。
- 协作模板首期仍为编码、标书、论文、视频脚本和小说五类模板，以及 Agent 任务、Todo、依赖/并行、人工审核和结果交接/汇总。

# 当前状态

- 已从最新 `master` 提交 `8a42cf6` 建立隔离工作区；13 项 TDD 计划已完成任务 1-9：共享契约、数据库、五模板、管理 API、运行快照/人工控制、Agent 租约执行、依赖/人工审核、Worker 恢复/实时刷新，以及六个协作 MCP 工具和 Local Sync 0.6.0 兼容面。仍未 push、发布 npm 或部署生产。
- 协作新增门禁通过：sync-protocol 36/36、隔离 PostgreSQL Schema 2/2、协作服务聚焦套件 57/57、API/Worker 模块图 2/2；任务 9 另通过服务端兼容测试 161/161、MCP 聚焦测试 20/20、前端兼容测试 23/23、Local Sync 全量 746/746，以及 server/client/local-sync 类型检查与构建。Worker 不导入 HTTP Controller/Guard，Redis/Socket 只发布 `spaceId/runId/eventSequence` 刷新提示。
- `0.5.1` 代码发行提交 `2700bac` 已推送到 GitHub `master`；`@neomei/agentwiki-local-sync@0.5.1` 已发布并成为 `latest`，Sync Protocol 保持 `0.2.0`。
- 最新本地全量验证通过：Runtime 90/90（47 个环境门禁跳过）、Server 797/797（3 个环境门禁跳过）、Client 235/235、Sync Protocol 25/25、Local Sync 743/743；lint、typecheck、build、生产依赖审计、peer 检查、部署脚本语法和 `git diff --check` 均通过。
- 独立安全基线审查覆盖 68 个文件；已修复 WebSocket 越权/资源放大、OpenCode 工具注入、限流身份绕过、Local Sync `spaceId` 穿越、Git 导入无边界等发现，并继续修复 Source/Run 与 Memory 的实时授权、重试身份、归档去重和并发竞态。
- Obsidian 连接现在本地统一到 `/guide/obsidian`：安装、服务器地址、连接码和设备管理同页；旧 `/settings/integrations` 仅重定向，不再保留第二套管理实现。
- GitHub `master` 已包含 `0.5.1` 代码与发行证据；带注释标签 `v0.5.1` 指向证据提交 `ad198e3`。npm registry 的 `0.5.1` shasum 为 `26cac22f6b156f6c53e5763d212d7e2072956bd1`，公开 CLI 返回 `{"version":"0.5.1"}`。
- npm 已发布 `@neomei/agentwiki-sync-protocol@0.2.0` 与 `@neomei/agentwiki-local-sync@0.5.1`；候选 tarball SHA-256 为 `8e7bd2723718c17a4335e1a96b4692de230d1e4052eb42ca2756b5d02f3e2ea2`。
- 生产已应用 40 条迁移，最新为 `20260823090000_bind_agent_credentials_to_grants`；API、Worker、Frontend 三项 user service 均 active、`NRestarts=0`，最终切换后 error 日志为 0。
- 公网 `/api/health` 的 database、redis、auditPersistence 均为 `ok`；生产统一授权烟测 `31/31` 通过，覆盖角色降权即时撤写、Editor 提案进入审核、Agent 不可审批、人工发布和清理。
- 已登录生产浏览器确认主导航直接显示“连接 Obsidian”，链接 `/guide/obsidian`；专页同屏提供安装、官方 `/api` 地址、连接码和设备管理。Agent 访问页只有“生成统一网关接入指令”一个接入动作，角色恰为 Reader、Editor、Publisher，无独立 Credential 授权控件，并显示 npm `0.5.1`。
- 发布验收发现并修复两类额外问题：部署包 AppleDouble/xattr 污染（`888113f`、`ba2bd72`）和 AuditService 在 Redis 初始化前排空事件的启动竞态（`d88e930`）。最终服务器 AppleDouble 文件为 0，启动 error 为 0。
- `0.5.1` 发布前回滚备份已验证：数据库 `/root/backups/agentwiki/pre-local-sync-0.5.1-20260823-223643.dump`（SHA-256 `644207455d12f8191b5c51b5a871e6b8dfd5ad29a6f045c6a079507c23adc222`），应用 `/root/backups/agentwiki/pre-local-sync-0.5.1-20260823-223643-app.tar.gz`（SHA-256 `046fbff3c2628a4272713d1d988ac4e5f92efbcbaa9f79194bcdcf0d85e9d26b`）。
- 生产已切换到应用与 Local Sync `0.5.1`，保留旧应用树 `/root/agentwiki-previous-20260823223846`；三项服务 active/running、`NRestarts=0`，部署后 error 日志为 0，公网和本机健康检查均为全 `ok`。
- 本轮没有改动真实 OpenCode 本机配置；生产验收使用真实公网 HTTP/MCP 客户端完成协议与权限闭环。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份、生命周期和 `authorizationId`，scopes 只能从当前 Grant 角色派生。
- 普通产品入口只使用 `reader | editor | publisher`；任何 Agent 都没有 `review:decide` 或成员管理权限。
- Agent 详情页唯一可编辑授权动作是生成 `Space + role` 连接；不得恢复独立 Grant 角色编辑器或手工 Credential 签发入口。
- Publisher 不修改 Space Policy；自动发布必须在发布临界点重验 Credential、Agent/owner、Grant、Space、Policy 与领域门槛。
- 高频集成流程应有显眼主入口；Obsidian 使用主导航 `/guide/obsidian` 专页，安装、连接码与设备管理必须同页，旧 `/settings/integrations` 只允许重定向。
- 协作运行保存不可变模板快照；人工审核只能由人类完成；现有 Local Knowledge Orchestrator 保持专用。

# 关键索引

- 统一访问角色验证：`agentwiki/docs/verification/unified-agent-access-roles-0.5.0.md`
- 统一访问角色部署门禁：`agentwiki/docs/operations/unified-agent-access-roles-0.5.0-deployment.md`
- 已归档统一访问角色任务：`.codex-memory/tasks/archive/unified-agent-access-roles/`
- 综合安全与可靠性审查：`.codex-memory/tasks/archive/comprehensive-security-reliability-audit-2026-08-23/`
- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 协作模板任务：`.codex-memory/tasks/active/agent-collaboration-templates/`

# 风险 / 下一步

- `0.5.1` 已完成 GitHub、npm 与生产对齐；后续重点是观察线上授权、同步和审计指标，不再需要补发。
- Git partial clone、树/对象/遍历上限和 LFS/filter 隔离已落地；生产 systemd 与 Docker Worker 的私有 `/tmp` 另有 256MiB tmpfs 硬上限。非生产或自定义运行方式若开放远程 Git，也必须提供等价磁盘配额。
- 旧 Agent Credential 已按破坏性迁移边界删除，需要通过新的统一连接入口重新接入。
- 回退 0.5.0 必须成对恢复 `pre-local-sync-0.5.1-20260823-223643` 数据库与应用备份，不能只回退 schema 或只切旧应用目录。
- 下一步从任务 10 开始实现 Space 协作工作台与模板库，随后完成模板编辑/启动向导、运行看板、可观测性、真实多 Agent E2E 和全量验收。
