# AgentWiki 当前实施设计

状态：Active
技术基线：React 18 + Vite + React Router；NestJS 10；Prisma 5；PostgreSQL。
本文件替代早期设计中与当前架构冲突的部分。

## 1. 产品边界

AgentWiki 以 Space 为安全边界，允许人类和受控 Agent 共同维护知识。

- Agent 是由人类拥有和授权的独立主体，不是可自注册的 User 类型。
- 自动生成知识必须可追溯到来源、任务、证据和执行主体。
- 自动写入默认进入人工审查；空间可配置受限自动发布。
- Agent 记忆是指定空间内的受控上下文，不是第二套 Wiki。
- MCP 只适配稳定领域服务，不得绕过授权、审批和审计。
- 不允许普通用户让服务器扫描任意本地路径。

## 2. 信息架构

### 全局导航

| 入口 | 路由 | 核心任务 |
|---|---|---|
| Spaces | `/` | 查看知识空间 |
| Agents | `/agents` | 创建、授权、暂停和审计 Agent |
| Review | `/review` | 处理跨空间待审批变更 |
| Search | `/search` | 在有权访问的空间中检索 |
| Profile | `/profile` | 个人资料和个人访问令牌 |

### 空间导航

| 入口 | 路由 | 核心任务 |
|---|---|---|
| Pages | `/spaces/:id` | 页面列表和最近变更 |
| Graph | `/spaces/:id/graph` | 知识关系与证据 |
| Sources | `/spaces/:id/sources` | 文本、文件、URL、Git 来源 |
| Runs | `/spaces/:id/runs` | 摄取和编译执行状态 |
| Members | `/spaces/:id/members` | 人类成员与角色 |
| Settings | `/spaces/:id/settings` | 审批策略、保留期和集成 |

旧 `Docs` 入口在统一 Run 落地后迁移到 Sources / Runs。Agent 详情使用 Overview、Access、Activity、Memory、Settings 五个标签。

## 3. 领域模型

### 身份与授权

- `User`：可登录的人类身份。
- `ApiKeyCredential`：人类个人访问令牌。
- `Agent`：由 User 拥有，状态 active / paused / revoked。
- `AgentCredential`：Agent 密钥；明文只显示一次。
- `AgentGrant`：Agent 对 Space 的 viewer / editor 授权。
- `SecurityAuditEvent`：登录、凭证和安全事件。
- `AgentAuditEvent`：Agent 的资源操作和结果。

### 知识与来源

- `Space`：成员、Agent Grant、页面、来源和审批策略的隔离边界。
- `Page` / `PageVersion` / `PageSearchDocument`：正式知识、可完整恢复的历史和持久词法索引；页面同时保留最初来源与最后一次修改来源。
- `KnowledgeRelation`：同一 Space 内的页面关系，保留生成者、证据、置信度、审批与最后修改者。
- `Source`：text / file / url / git 来源。
- `IngestRun`：可恢复的摄取、提取、编译和索引执行。
- `Artifact`：分块、实体、候选页面等中间产物。
- `Evidence`：结果到来源版本和片段的可定位证据。

### 审批与记忆

- `ChangeSet`：一次编译产生的候选变更集合。
- `ChangeItem`：create/update page/relation。
- `Approval`：审查结论和审查者。
- `AgentMemory`：episodic / semantic 记忆，绑定 Agent、Space 和证据；private 仅目标 Agent，space 可由同一 Space 内获授权 Agent 召回。

## 4. 权限矩阵

| 操作 | Owner | Editor | Viewer | Agent viewer | Agent editor |
|---|---:|---:|---:|---:|---:|
| 读取空间/页面/图谱/搜索 | ✓ | ✓ | ✓ | 按 Scope | 按 Scope |
| 创建/编辑页面和关系 | ✓ | ✓ | — | — | 按 Scope/审批 |
| 创建来源/运行任务 | ✓ | ✓ | — | — | 按 Scope |
| 审批变更 | ✓ | 可配置 | — | — | — |
| 管理成员/空间策略 | ✓ | — | — | — | — |
| 创建 Agent/修改授权 | Agent Owner | — | — | — | — |
| 读取 Agent Memory | Agent Owner | — | — | 本 Agent 私有 + 同 Space 共享 + Scope | 本 Agent 私有 + 同 Space 共享 + Scope |

规则：

- 默认拒绝；认证成功不等于资源授权成功。
- Agent 权限取 AgentGrant、Credential Scope、Agent 状态和空间策略的交集。
- 所有资源必须通过 Space 反查授权；关系两端不能跨 Space。
- 个人令牌继承用户成员角色；Agent 密钥绝不继承 Agent Owner 的成员角色。

稳定 Agent Scope：`spaces:read`、`pages:read/write`、`graph:read/write`、`sources:read/write`、`runs:read/write`、`review:read`、`review:auto-publish`、`memory:read/write`。`review:decide` 仅属于人类 Owner 的领域操作，不签发给 Agent Credential。Agent Credential 必须使用显式 Scope。

## 5. 状态机

- Agent：`active → paused → active`；`active|paused → revoked`。revoked 不可恢复。
- Source：`active → archived`。内容变化创建新版本，不覆盖旧证据。
- Run：`queued → reserved → fetching → extracting → compiling → indexing → completed`；自动发布时经过 publishing；可进入 partial / failed / cancelled。Worker 使用可续租的 fenced lease，并在多个阶段复核当前凭证、Scope、Agent 与 Space Grant。
- ChangeSet：`draft → pending_review → approved → publishing → published`；可 rejected / reverting / reverted。ChangeItem 支持 create/update/archive page 与 create/archive relation；发布前使用更新时间做乐观并发校验。只有逐项 accepted 的候选可发布，pending 会阻止整体批准；Agent 的 REST 与 MCP 页面/关系写入均先形成 ChangeSet。
- Memory：`active → archived → deleted`；整合生成新 semantic memory并保留来源引用。

## 6. REST API 契约

继续使用 `/api` 前缀；破坏性升级才引入 `/api/v2`。

- 列表使用 `skip/take`，最大 100，返回 `{data,total,page,limit}`。
- 创建任务支持 `Idempotency-Key`。
- 错误返回 `{statusCode,code,message,requestId,timestamp,path}`。
- 密钥明文仅在创建响应出现一次。

### Agent

`POST|GET /api/agents`；`GET|PATCH|DELETE /api/agents/:id`；`POST|GET /api/agents/:id/credentials`；`DELETE /api/agents/:id/credentials/:credentialId`；`PUT|DELETE /api/agents/:id/grants/:spaceId`；`GET /api/agents/:id/activity`。

### Sources 与 Runs

`POST|GET /api/spaces/:spaceId/sources`；`GET|PATCH|DELETE /api/sources/:id`；`POST /api/sources/:id/runs`；`GET /api/spaces/:spaceId/runs`；`GET /api/runs/:id`；`POST /api/runs/:id/retry|cancel`。

### Review

`GET /api/review`；`GET /api/change-sets/:id`；`POST /api/change-sets/:id/submit|approve|reject|publish|revert`。

### Memory

`POST|GET /api/agents/:agentId/memories`；`POST /api/agents/:agentId/memories/recall|consolidate`；`POST /api/memories/:id/archive`；`DELETE /api/memories/:id`。

错误码至少包括：`AUTH_INVALID_CREDENTIALS`、`AUTH_RATE_LIMITED`、`AUTH_SCOPE_REQUIRED`、`SPACE_ACCESS_DENIED`、`RESOURCE_NOT_FOUND`、`RESOURCE_CONFLICT`、`SOURCE_INVALID`、`SOURCE_TOO_LARGE`、`RUN_NOT_RETRYABLE`、`CHANGESET_INVALID_STATE`、`APPROVAL_REQUIRED`、`MEMORY_QUOTA_EXCEEDED`。

## 7. 威胁模型与保留

| 威胁 | 控制 |
|---|---|
| 跨空间 IDOR | 所有资源通过 Space 反查；默认拒绝 |
| API Key 泄漏 | 高熵、哈希存储、一次显示、过期、撤销、最后使用 |
| Agent 越权 | Grant + Scope + 状态三重校验 |
| URL/Git SSRF 与注入 | URL 解析全部地址后拒绝非公网地址并固定 DNS 结果；Git 使用 HTTPS 主机白名单、无 shell 参数、隔离临时目录、超时/大小限制 |
| 本地路径读取 | 对用户接口完全禁用；仅接受文本、受支持文件、安全 URL 和允许域名 Git |
| 源码秘密外传 | 分块前秘密扫描与脱敏；记录模型去向 |
| 自动内容污染 | 默认 ChangeSet 审批、证据和回滚 |
| 队列重复执行 | Worker 身份、可过期/续租 lease、幂等键、内容唯一键、attempt、周期恢复与发布乐观锁 |
| WebSocket 冒充 | 握手 JWT 后重新查询当前人类用户、页面授权、不信任客户端 userId/userName |

默认保留：安全与 Agent 审计 180 天；Run 错误和元数据 90 天；被正式内容引用的 Evidence 不得物理删除。

## 8. 需求追踪

| 能力 | 数据 | API | 页面 | 核心测试 |
|---|---|---|---|---|
| Agent 治理 | Agent/Grant/Credential/Audit | `/agents` | Agents/Access/Activity | 越权、暂停、撤销 |
| 摄取来源 | Source/Run/Artifact/Evidence | `/sources`、`/runs` | Sources/Runs | SSRF、去重、恢复 |
| 审批发布 | ChangeSet/Item/Approval | `/review` | Review/Diff | 绕过、并发、回滚 |
| 来源追踪 | Evidence | 页面/图谱详情 | Provenance | 跨空间、删除 |
| Agent Memory | AgentMemory | `/memories` | Agent/Memory | 隔离、召回、删除 |
| MCP | 复用领域模型 | MCP adapter | Integrations/MCP | Scope、错误、审计 |

## 9. 发布门禁

每个阶段必须同时满足 Prisma 校验与迁移、服务端类型检查与测试、客户端类型检查与生产构建、页面文案真实、整改清单和任务记忆同步。
