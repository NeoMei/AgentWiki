# Agent 统一访问角色设计

日期：2026-08-22
状态：已确认
选定方案：连接凭据绑定单一 Space Grant 授权

## 背景

当前 Agent 的 Space Grant、一次性连接码 scopes 和手工 Credential scopes 分别配置。运行时权限又取 Credential Scope、Space Grant、Agent 状态和 Space Policy 的交集，因此界面显示 `editor` 并不代表连接所用 Credential 一定拥有写权限。

实际缺陷是本地同步连接码的固定 scopes 包含 `pages:read`，却不包含 `pages:write`。OpenCode 因而可以列出 Space 和页面，却在调用 `wiki_propose_page` 时收到 `AUTH_SCOPE_REQUIRED`。这不是 OpenCode 的问题，而是 AgentWiki 将“加入 Space”和“签发连接凭证”拆成了两套互不一致的授权动作。

## 目标

- 用户只选择一次 Space 和 Agent 角色；凭据只绑定授权，不再拥有独立角色。
- 角色名称统一为 `reader`、`editor`、`publisher`。
- `AgentGrant.role` 是唯一持久化权限事实，scopes 在请求时由统一角色表派生。
- `AgentCredential` 只保存身份、生命周期和所绑定的 Grant，不保存 role 或 scopes。
- `editor` 必须能够调用 `wiki_propose_page`，产生的变更仍进入人工审核。
- `publisher` 可以获得 Agent 可用的完整内容权限，但不能管理成员、执行人工审批或获得 `review:decide`。

## 不做

- 不兼容旧客户端的 `viewer`、`full` 或任意自定义 scopes 请求。
- 不迁移、识别或继续编辑旧版本自定义 Credential/Grant 数据。
- 不把 Agent 角色等同于人类的 `owner`、`admin`、`editor`、`viewer` 成员角色。
- 不允许 Agent 自己批准变更。
- 不放宽 Space Policy、Agent 状态或资源归属检查。

## 角色模型

服务端维护唯一角色定义：

| Agent 角色 | Space 能力级别 | 展开的 scopes | 产品行为 |
|---|---|---|---|
| `reader` | 只读 | `spaces:read`、`pages:read`、`graph:read`、`sources:read`、`runs:read`、`review:read` | 可发现和读取知识，不能产生写操作 |
| `editor` | 编辑 | `reader` 全部 scopes，加 `pages:write`、`graph:write`、`sources:write`、`runs:write` | 可提交页面、图谱、来源和任务变更；默认进入人工审核 |
| `publisher` | 发布 | `editor` 全部 scopes，加 `memory:read`、`memory:write`、`review:auto-publish` | 可使用 Memory；当所有治理门槛同时允许时可自动发布 |

`review:decide` 不属于任何 Agent 角色。`publisher` 不是人类管理员，也不获得 Space 成员管理、Agent 管理或审批权限。

角色只记录在 `AgentGrant` 上，展开后的 scopes 不持久化。`AgentCredential.authorizationId` 通过数据库复合外键绑定同一 Agent 的一个 Grant。应用代码只能通过统一角色策略从当前 Grant 角色派生 scopes，不能在 Grant、Credential 或连接码接口中提交任意 scope 数组。

有效权限继续取下列条件的交集：

1. Credential、Agent 及 owner 当前有效；
2. Credential 绑定的目标 Space AgentGrant 当前角色；
3. Agent 当前状态及全局能力开关；
4. Space Policy；
5. 具体领域操作的角色和资源约束。

## 统一连接授权包

连接授权包由 `agentId + spaceId + role + pluginVersion` 组成。它代替当前只携带 Credential scopes 的本地同步安装码。

### 生成连接码

用户在 Agent 的访问页面选择目标 Space 和 `reader`、`editor` 或 `publisher`。服务端先验证：

- 当前用户拥有目标 Agent；
- Agent 处于 active 状态；
- 当前用户对目标 Space 具备 owner 或 admin 权限；
- 角色和插件版本受当前服务端支持。

通过后，服务端只把授权意图写入有期限的 Redis 记录并返回一次性连接码。生成连接码不会提前创建 Grant、Credential 或修改 Agent 能力。

### 兑换连接码

OpenCode、Codex 或 Claude Code 兑换连接码时，服务端重新验证用户、Agent、Space、角色和连接码状态，不能依赖生成连接码时的授权结果。

随后在同一个 PostgreSQL 事务中：

1. 创建或更新目标 Space 的 AgentGrant，并记录唯一角色；
2. 创建或幂等取得本次安装对应的 AgentCredential，并把它绑定到该 Grant；
3. 从 Grant 当前角色派生只读 scopes 诊断信息；
4. 当角色为 `publisher` 时，启用 Agent 的 Memory 和 `scoped-auto-publish` 能力开关；
5. 写入包含 Agent、Space、Credential、旧角色和新角色的审计事件。

事务任一步骤失败都全部回滚。连接成功前，不存在“只有 Grant”或“只有 Credential”的半套有效授权。

安装码继续使用唯一 installation id 和确定性密钥派生。Redis 回执写入失败或客户端丢失响应时，重试同一个连接码会取得同一 Credential，不会重复创建密钥。并发兑换同一个连接码只能提交一条 Credential。

## 多 Space 与多 Credential 语义

AgentGrant 是 Agent 在一个 Space 内的唯一权限事实。每个 AgentCredential 只能绑定其中一个 Grant，因此一个连接只能访问其绑定 Space；同一 Agent 访问另一 Space 时需要另一条绑定该 Space Grant 的连接。

例如：

- Credential 绑定 `reader` Grant 时只能读取；
- 把该 Grant 升为 `editor` 后，所有绑定连接立即可以提交写入提案；
- 把该 Grant 降为 `reader` 后，所有绑定连接立即失去写能力；
- 只有绑定 Grant 为 `publisher`，且 Agent 与 Space 的自动发布治理条件同时允许时，才可能自动发布。

同一个 Space 只有一个 `(agentId, spaceId)` Grant。生成连接码时如果目标 Space 已有不同角色，界面必须在签发前显示旧角色和新角色，说明连接成功后会调整该 Agent 在该 Space 的能力上限。

角色降级会立即收紧 Grant，因此所有绑定 Credential 同步生效。降级不主动关闭 Agent 的 Memory 或自动发布全局开关，因为其他 Space 可能仍有 `publisher` Grant；缺少对应 Grant 角色时，这些开关本身不能授予权限。

## API 边界

新的普通产品接口只在连接授权包上接受角色，不接受任意 scopes：

- 创建连接授权包：`agentId`、`spaceId`、`role`、`pluginVersion`；
- 查看和撤销已有连接凭据，但不提供手工创建 Credential 的 Agent API；
- Space 成员管理流程仍可修改或移除 AgentGrant，但 Agent“访问权限”页不再把它作为第二个授权表单。

服务端把 Credential 显示为“连接记录 + 所绑定的授权”，其中角色和只读 scopes 均从 Grant 实时派生；客户端不能把响应 scopes 修改后回传以改变权限。

角色策略应位于服务端、Local Sync 和契约测试可共同引用的单一模块。前端通过服务端契约展示角色说明，不维护另一套权限数组。所有 DTO、会话 schema、计划哈希和安装码 payload 都使用 `reader | editor | publisher`。

## 前端体验

Agent“访问权限”页只保留一个可编辑的授权区域，并附带只读/撤销记录：

### 连接 Agent

- 选择 Space；
- 选择 `Reader`、`Editor` 或 `Publisher`；
- 展示该角色的简短能力说明；
- 若 Space 已有不同角色，展示角色变更提示；
- 生成一次性连接码并展示有效期、复制和重新生成操作。

`Publisher` 必须显示提示：自动发布仍受 Space Policy 限制，并且 Agent 不能执行人工审批或成员管理。

### 现有授权与连接记录

- Space 授权记录显示当前 Agent 角色并允许移除，不再提供独立角色下拉框；角色变更通过上方的统一连接表单重新授权。
- Credential 记录显示名称、绑定 Space 及其当前角色、前缀、最后使用时间、过期时间和撤销操作，但不把角色/scopes 画成 Credential 自身字段。
- 如需显示 scopes，只能嵌套在所绑定的 Space 授权诊断中。

当前分离的“Space Access”“Local Sync 连接授权”“Credential 授权”不再作为三套可编辑控件存在。Agent 访问页中只能找到一个 Agent 角色选择器。

## Publisher 治理

选择 `publisher` 会为 Credential 和 Grant 加入 `review:auto-publish`，并启用 Agent 的 `approvalMode = scoped-auto-publish` 与 Memory 能力。自动发布仍必须同时满足：

- Space `approvalPolicy = scoped-auto-publish`；
- Agent `approvalMode = scoped-auto-publish`；
- 当前 Credential 包含 `review:auto-publish`；
- 当前 Space Grant 包含 `review:auto-publish`；
- 当前领域操作允许自动发布。

连接授权不会静默修改 Space Policy。如果 Space 仍是 always-review，Publisher 的变更继续进入人工审核。

## 错误处理

- 非法角色在 DTO 边界拒绝，不能进入 Redis 或数据库。
- Agent 非 active、用户失去 Agent 所有权、用户失去 Space 管理权、Space 被删除或连接码过期时，兑换失败且不写入授权。
- 角色不具备所需能力时沿用稳定的 `AUTH_SCOPE_REQUIRED` 或 `SPACE_ACCESS_DENIED` 语义。
- Redis 暂时不可用时不签发新连接码；PostgreSQL 事务失败时不写成功回执。
- 明文 API key 只在首次成功兑换或幂等恢复时返回，不进入日志和审计 metadata。
- 审计记录角色和资源标识，不记录明文密钥、完整连接码或哈希原材料。

## 测试与验收

### 角色策略

- 精确断言三个角色展开后的 scopes；
- 断言角色包含关系为 `reader < editor < publisher`；
- 断言任何角色都不包含 `review:decide`；
- 断言非法角色和任意 scopes 输入被拒绝。

### 服务端事务

- 连接兑换原子创建 Credential 和 Grant；
- Grant 或 Credential 写入失败时事务完全回滚；
- 重复和并发兑换只产生一条 Credential；
- 兑换前重新校验 Agent、Space 和操作者授权；
- 角色升降级立即改变 Space 能力上限；
- `publisher` 启用 Agent 能力但不修改 Space Policy。

### 前端与本地连接

- 访问页面只提供三档角色；
- 访问页面只有一个可编辑的角色选择器，不存在独立 Grant 授权表单或手工 Credential 签发表单；
- 生成连接码提交 `spaceId + role`，不提交 scopes；
- 已有 Grant 变更提示准确；
- Credential 只能由连接授权包兑换产生，Agent API 不提供手工创建路由；
- Local Sync 的会话 schema、计划哈希、协调器和三客户端安装流程使用同一角色协议。

### MCP 行为

- `reader` 能调用 `wiki_list_spaces` 和 `wiki_list_pages`，调用 `wiki_propose_page` 被拒绝；
- `editor` 能调用 `wiki_propose_page`，结果进入 `pending_review`，且不能调用人工审批；
- `publisher` 只有在 Credential、Grant、Agent 和 Space Policy 全部允许时自动发布；
- 任意角色都不能获得或调用 `review:decide`。

### 真实验收

在真实 OpenCode 连接中以 `editor` 角色重新连接 NeoMei-Space：

1. 列出页面并找到“吃饭睡觉打豆豆”；
2. 提交加入“豆豆不能随便打”的页面修改；
3. 确认服务端创建待人工审核的变更集；
4. 确认 OpenCode 无法自行批准该变更；
5. 由人类批准后确认页面内容生效。

发布前还必须运行服务端、前端、sync-protocol、local-sync、MCP 契约、类型检查、lint 和 build 全量门禁，并在部署后重新执行公网 API 与真实客户端 smoke。

## 完成标准

- 产品界面只存在一个 `Space + role` 授权入口，不存在独立的 Grant 或 Credential 授权表单；
- Agent API 不提供手工签发 Credential 的第二条授权路径；
- 所有新 Grant、Credential 和连接码只使用 `reader`、`editor`、`publisher`；
- OpenCode 的 editor 连接可以提议页面修改，并继续受人工审核约束；
- 多 Space、多 Credential 的最小权限交集仍然有效；
- 自动发布和 Memory 不绕过 Agent 状态、Space Policy 或领域权限；
- 自动化测试与真实 OpenCode 验收均提供新鲜证据。
