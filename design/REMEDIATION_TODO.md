# AgentWiki 全量整改 To-do

本清单是整改实施与验收的唯一进度入口。必须按阶段依赖顺序执行；只有代码、迁移、测试、构建和必要文档均通过后才能勾选。

## P0 安全与工程基线

- [x] 建立统一资源授权服务，默认拒绝未明确授权的访问。
- [x] 页面列表、详情、层级、版本、搜索全部实施空间级读取授权。
- [x] 页面创建、更新、删除、恢复按 owner/editor/viewer 实施写入授权。
- [x] 图谱读取和关系增删改实施空间级授权，并校验关系两端属于同一空间。
- [x] 来源与摄取任务创建、列表、状态查询实施空间级授权。
- [x] 禁止公开注册自行声明 Agent 身份；Agent 只能由受权人创建。
- [x] 建立独立 API Key 表，支持前缀索引、哈希存储、Scope、过期、撤销、轮换和最后使用时间。
- [x] 为认证接口和 API Key 增加速率限制与安全审计事件。
- [x] 禁止普通用户提交任意服务器本地路径；扫描使用受控工作目录。
- [x] 实现 Git URL 的安全克隆或移除虚假入口，并限制协议、大小、时长和并发。
- [x] 文档生成迁移到可靠队列，支持超时、失败、重试、幂等和进程重启恢复。
- [x] 修复 Jest/TypeScript 配置、排除 dist、增加统一 test/typecheck/lint 脚本。
- [x] 增加授权、认证、文档任务和路径安全集成测试。
- [x] 清理 Space 页面重复入口及明显 UI/结果字段错误。
- [x] P0 验收：测试、构建、Prisma 校验、权限回归全部通过。

## P1 当前架构设计重基线

- [x] 将旧 Next.js 与 `/wiki` 设计统一更新为当前 React/Vite + React Router 架构。
- [x] 冻结产品信息架构：全局 Spaces / Agents / Review / Search；空间 Pages / Graph / Sources / Runs / Members / Settings。
- [x] 完成领域模型与 ERD：Agent、Credential、Grant、Audit、Source、Run、Artifact、Evidence、ChangeSet、Approval、Memory。
- [x] 完成角色、Scope、资源和操作权限矩阵。
- [x] 完成 Source/Run/ChangeSet/Approval/Memory 状态机和异常路径。
- [x] 完成 REST API 契约、分页、错误码、幂等和版本策略。
- [x] 完成威胁模型、数据保留、秘密信息过滤和审计策略。
- [x] 建立需求—接口—数据—页面—测试追踪矩阵。
- [x] P1 验收：所有 P2-P6 功能无阻塞性产品/架构待决项。

## P2 Agent 控制面

- [x] 实现 Agent、AgentGrant、AgentCredential、AgentAudit 数据模型与迁移。
- [x] 实现 Agent CRUD、暂停/恢复、授权、密钥创建/轮换/撤销 API。
- [x] 将 Agent API Key 身份映射到 Agent、Owner、Scope 和 Space Grant。
- [x] 为所有 Agent 写操作记录审计日志和关联资源。
- [x] 实现 `/agents` 列表及创建入口。
- [x] 实现 `/agents/:id` Overview / Access / Activity / Settings。
- [x] Profile 中区分个人令牌与 Agent 凭证。
- [x] 增加 Agent 管理、权限越界、撤销和审计测试。
- [x] P2 验收：Agent 行为可归属、可限制、可暂停、可撤销、可审计。

## P3 摄取、来源与运行任务

- [x] 实现 Source、IngestRun、Artifact、Evidence 数据模型与迁移。
- [x] 支持文本、文件、URL、Git 仓库四类来源及统一校验。
- [x] 实现受控获取、格式识别、内容哈希、去重、分块和秘密过滤。
- [x] 实现任务阶段：queued / fetching / extracting / compiling / indexing / completed / partial / failed / cancelled。
- [x] 实现增量更新、Git commit/file 快照和重复任务幂等。
- [x] 将现有 DocumentGenerationJob 数据和接口迁移到统一 Run 模型。
- [x] 实现空间 `Sources` 页面与来源详情。
- [x] 实现空间 `Runs` 页面、阶段进度、错误、重试和取消。
- [x] 增加来源获取、去重、失败恢复、增量更新和隔离测试。
- [x] P3 验收：任何生成结果都可追踪到来源、版本、任务和证据。

## P4 编译、审批与来源展示

- [x] 实现 ChangeSet、ChangeItem、Approval 数据模型与迁移。
- [x] 编译结果先形成页面/关系候选变更，不直接写入正式内容。
- [x] 实现批准、拒绝、批注、部分批准、发布和回滚。
- [x] 支持按空间配置 Agent 的 always-review / scoped-auto-publish 审批模式。
- [x] 实现全局 `/review` 待审批队列和数量徽标。
- [x] 实现空间级 Review 过滤与变更 diff。
- [x] 页面展示创建者、来源、证据、置信度、审批和生成版本。
- [x] 图谱边展示来源、证据、生成方式、置信度和审批状态。
- [x] 增加审批绕过、并发审批、部分失败和回滚测试。
- [x] P4 验收：Agent 自动生成内容可审查、可追溯、可拒绝、可回滚。

## P5 Agent 记忆

- [x] 先实现 episodic / semantic 两类最小记忆模型，不虚构未验证的四层算法。
- [x] 实现记忆写入、检索、召回、整合、归档和删除 API。
- [x] 记忆绑定 Agent、Space、来源、证据、重要度和可见范围。
- [x] 实现配额、保留期、去重、访问审计和隐私删除。
- [x] 实现 Agent 详情 Memory 页面及召回解释。
- [x] 建立关键词/向量/图关系混合召回质量测试集。
- [x] 只有质量数据支持时再启用衰减，不以时间衰减替代保留策略。
- [x] P5 验收：记忆隔离正确、召回可解释、删除可验证、质量可衡量。

## P6 MCP 与集成

- [x] 定义 MCP tools/resources 与现有服务层的映射。
- [x] MCP 认证复用 AgentCredential、Scope、Space Grant 和审计。
- [x] 实现页面、搜索、图谱、来源、运行、审批和记忆的最小工具集。
- [x] 禁止 MCP 绕过 REST/领域服务直接访问数据库。
- [x] 实现 Settings → Integrations → MCP 配置、连接状态、工具范围和最近调用。
- [x] 编写 stdio/streamable HTTP 接入指南与示例配置。
- [x] 增加 MCP 越权、撤销、输入校验、错误映射和兼容性测试。
- [x] P6 验收：外部 Agent 可安全连接，行为与 REST 权限一致且完整审计。

## 最终验收

- [x] 所有数据库迁移可从空库执行，并验证旧数据迁移路径。
- [x] 服务端单元、集成、端到端和安全测试全部通过。
- [x] 客户端类型检查、生产构建和关键页面交互测试全部通过。
- [x] API、使用指南、部署、备份恢复和运维文档与实现一致。
- [x] 清理过期设计、虚假产品文案、死代码、重复入口和构建产物污染。
- [x] 对本清单逐条复核，无未解释的跳过项或占位实现。

## 最终验证记录（2026-07-16，远端发布完成）

- 备份：迁移前生成 PostgreSQL 18.4 custom-format 逻辑备份 `C:\Users\1\AgentWikiBackups\agentwiki-pre-migrate-20260716-003650.dump`，SHA-256 为 `4665974C0F66E091B0403754E4943E62B75AD8B589080C35FD567F0207AE17FF`；337 个 TOC 条目可读，并在隔离临时数据库完成除需管理员预装的 `vector` 扩展声明外的完整恢复验证（26 张表、9 条迁移），临时库已删除。
- Prisma：4 个待发布迁移已经部署；远端 PostgreSQL 当前 13/13，`prisma migrate status` 返回 `Database schema is up to date!`。
- 运行方式：按既有约束采用源码直部署，不使用 Docker。`agentwiki-api.service`、`agentwiki-worker.service`、`agentwiki-frontend.service` 三个用户级 systemd 服务均为 `active/running`，`NRestarts=0`；Docker 容器数量为 0，临时基础镜像已清理。
- 健康检查：新增 `GET /api/health`；远端返回 `database=ok`、`redis=ok`，前端 5173 返回 HTTP 200。API 与 Worker 的 Nest 完整依赖图均有自动化启动测试，防止仅编译通过但运行期 DI 失败。
- 业务冒烟：真实完成注册 → 私有 Space → Page → Search → Agent Grant/Credential → MCP `list_pages` → MCP 审计 → Text Source → Worker Run → ChangeSet 全项接受 → 审批 → 发布 → Page provenance；Run 为 `queued → completed`，来源、SourceVersion 与 ChangeSet 追踪完整。临时用户和空间已物理删除。
- 测试与构建：16 个 Jest 套件、58 项服务端测试及 2 项 Vitest 客户端测试全部通过；双端 TypeScript、ESLint、Nest/Vite 生产构建全部通过。
- 界面：Playwright + 本机 Chrome 已完成统一空间六入口、Sources → Runs、页面来源侧栏、Review 证据及 390×844 移动端检查，控制台零 warning/error。
