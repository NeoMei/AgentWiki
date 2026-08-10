# Agent 自助接入与统一本地网关 MCP 设计

> 日期：2026-08-10
> 目标版本：`@neomei/agentwiki-local-sync@0.3.0`
> 状态：设计已由用户确认，尚未进入实施

## 1. 背景

AgentWiki 当前已经能够通过 `/api/onboard.json` 引导本地 Agent 完成账号注册、Space 创建、Agent 身份、授权、远程 MCP 注册和 local-sync 安装。但当前流程把两套工具放在同一段提示词中：

- 远程 AgentWiki MCP：页面、图谱、审核、记忆等服务端工具。
- 本地 local-sync MCP：代码/文档扫描、整理、预览、同步和冲突处理工具。

本地 Agent 容易把 `start_knowledge_job` 等本地工具发给远程 MCP，最终得到“工具不存在”。这是接入契约和运行时路由不确定造成的问题，不是两套 MCP 协议本身不兼容。

同时，纯提示词流程依赖 Agent 自行理解步骤、保存变量、选择工具和恢复失败状态，不足以作为收费服务的稳定接入路径。

## 2. 目标

用户只需把一条固定版本命令交给 Codex、Claude Code、OpenCode 或其他能运行本地命令的 Agent。接入脚本负责：

1. 通过网页 Device Auth 完成注册或登录，不让密码进入 Agent 对话。
2. 通过 NDJSON 表单协议让 Agent 向用户收集必要参数。
3. 汇总完整计划，用户只确认一次接入计划。
4. 创建或复用 Space、Agent、Grant 和一次性安装凭据。
5. 原子安装一个名为 `agentwiki` 的本地网关 MCP。
6. 由网关确定性区分本地、远程和组合任务。
7. 在当前 onboarding 进程中完成首次本地扫描和知识预览。
8. 用户确认同步预览后，把整理后的知识同步到 AgentWiki。
9. 输出结构化接入报告和可恢复 session ID。

## 3. 非目标

- 不把原始代码、原始文档、原始 Agent Memory 数据库或本地凭据上传到服务端。
- 不要求用户手写 MCP JSON、Agent Key、Space ID 或安装码。
- 不通过自然语言解析替代确定性参数协议。
- 不启动本地 HTTP 端口或常驻后台 daemon；本地网关继续使用 stdio MCP。
- 不让服务端读取本地路径或反向控制用户设备。
- 不绕过现有 Credential Scope、Space Grant、Space Policy、ChangeSet 和审批规则。
- 不删除远程 MCP 的轻量接入方式；不需要本地扫描的用户仍可使用它。

## 4. 用户入口

AgentWiki 网页生成固定版本命令：

```bash
npx --yes @neomei/agentwiki-local-sync@0.3.0 onboard \
  --server https://agentwiki.quukk.com/api \
  --protocol ndjson
```

网页文案明确说明：这是以本地 Agent 执行的完整接入流程，不是只适用于某一个 Agent 产品。命令必须固定精确版本；服务器与本地包完成版本协商后才能继续。

脚本同时保留 `--protocol human`，供用户直接在终端运行。Agent 自动接入默认使用 `ndjson`。

## 5. 总体架构

```text
Local Agent
    │ stdio MCP
    ▼
AgentWiki Local Gateway
    ├── wiki_*      ── RemoteMcpBridge ── AgentWiki /api/mcp
    ├── local_*     ── LocalOrchestrator ── Source Adapters / local workspace
    └── knowledge_* ── WorkflowCoordinator ── local prepare + confirmed remote sync
```

完整 onboarding 只安装一个本地 MCP。Agent 不再选择“调用远程 MCP 还是本地 MCP”；每个工具在网关注册时已经绑定执行平面。

### 5.1 执行平面

| 工具前缀 | 执行平面 | 示例 |
| --- | --- | --- |
| `wiki_*` | 远程 | `wiki_list_pages`、`wiki_propose_page`、`wiki_list_graph` |
| `local_*` | 本地 | `local_scan_sources`、`local_read_artifacts` |
| `knowledge_*` | 组合 | `knowledge_prepare`、`knowledge_confirm_and_sync`、`knowledge_pull` |

正常使用优先暴露高层组合工具，避免 Agent 手工拼接长链路。已有低层 orchestrator 工具保留一个版本周期的别名，供高级用户和迁移使用。

### 5.2 远程工具桥接

`RemoteMcpBridge` 使用存储在本地凭据库中的 Agent Credential 连接 `/api/mcp`。它不复制一套 REST 业务语义，而是代理远程 MCP 的 `tools/list` 与 `tools/call`：

- 在线启动时获取服务端工具 schema，并映射为 `wiki_*`。
- 将最后一次验证通过的 schema 以非敏感 manifest 缓存在本地。
- 离线启动时仍注册缓存或随包发布的远程工具 manifest；调用时返回结构化 `REMOTE_UNAVAILABLE`，本地工具保持可用。
- 服务端工具版本与本地兼容范围不一致时，doctor 在执行任务前失败并要求升级。
- 远程和本地出现同名工具时，以执行平面前缀消除冲突，禁止静默覆盖。

### 5.3 组合工作流

用户说“扫描当前代码库并同步到 AgentWiki”时，Agent 只需调用：

1. `knowledge_prepare`
   - 本地发现 Source Adapter。
   - 执行 codebase-memory、MarkItDown 或未来 agent-memory Adapter。
   - 在本地整理并生成 preview Bundle。
   - 返回 `jobId`、摘要、校验和和预览路径，不上传内容。
2. 用户确认同步预览。
3. `knowledge_confirm_and_sync`
   - 校验 `jobId`、preview hash、服务端 Revision 和确认状态。
   - Push 前强制 Pull，执行 base/local/remote 三方检查。
   - 只上传确认后的知识 Bundle。
   - 返回页面、关系、Revision、ChangeSet 和审核状态。

## 6. 网页 Device Auth

这里采用 AgentWiki 自有的、形态类似 OAuth Device Authorization Grant 的 first-party device flow，不要求把 AgentWiki 注册成第三方 OAuth Provider，也不把 Google 或其他登录凭据交给本地脚本。

### 6.1 服务端接口

`POST /api/onboard/device/start`

- 公共、限流接口。
- 输入本地包版本、Agent 客户端类型和请求用途。
- 返回高熵 `deviceCode`、短 `userCode`、`verificationUri`、轮询间隔和过期时间。
- 服务端只保存 `deviceCode` 哈希。

`POST /api/onboard/device/poll`

- 输入 `deviceCode`。
- 返回 `authorization_pending`、`slow_down`、`denied`、`expired` 或一次性 onboarding token。
- onboarding token 有效期 10 分钟，只能调用 bootstrap。首次成功 mutation 后标记为 consumed；在有效期内，携带相同 token、相同 `Idempotency-Key` 和相同 server plan hash 的重放只能读取已保存结果，不能产生第二次 mutation。

`GET /onboard/device?user_code=...`

- 用户在网页注册或登录。
- 网页展示客户端、请求用途、目标服务器和即将进入的接入流程。
- 用户允许或拒绝该 device session。
- 密码、Google 登录信息和人类 access token 不返回本地 Agent。

`POST /api/onboard/bootstrap`

- 使用 onboarding token、`Idempotency-Key` 和已确认的 server plan hash。
- 在事务与幂等记录保护下创建或复用 Space、Agent 和 Grant。
- 根据权限模板生成限定 Scope 的一次性 local-sync installation code。
- 不向 stdout 或 Agent 返回长期 API Key。
- installation code 仍通过现有 exchange 流程换取本地 Credential，并只写入权限为 `0600` 的凭据文件。

### 6.2 安全边界

- Device code 使用密码学安全随机值；数据库只保存哈希。
- `userCode` 有短有效期、尝试次数限制、IP/账号/device 维度限流。
- 网页确认使用现有登录安全机制和 CSRF 防护。
- onboarding token 绑定 device session、用户、客户端、精确包版本和允许的最大 bootstrap capability。
- bootstrap 的 server plan 只能是 device session 所请求 capability 的子集；本地计划和扫描路径不发送到服务端。
- bootstrap 不能执行普通页面、图谱、审核或管理操作。
- Agent Credential 的最终权限仍是 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。

## 7. NDJSON 填空协议

stdout 只允许输出一个 JSON object 一行的协议事件；诊断日志只写 stderr。每个事件都包含 `protocolVersion`、`sessionId`、时间和单调递增序号。

脚本输出事件：

```json
{"type":"input_required","requestId":"r1","fields":[...]}
{"type":"authorization_required","url":"...","userCode":"ABCD-EFGH"}
{"type":"progress","step":"install_gateway","status":"running"}
{"type":"preview","plan":{}}
{"type":"confirmation_required","requestId":"r2","planHash":"..."}
{"type":"completed","report":{}}
```

Agent 通过 stdin 回复：

```json
{"requestId":"r1","values":{"spaceMode":"create","spaceName":"研发知识库","agentName":"Codex","sourcePaths":["."]}}
{"requestId":"r2","confirmed":true,"planHash":"..."}
```

协议要求：

- 脚本不解析自然语言。
- 不允许未声明的隐藏 stdin prompt。
- 未知字段被拒绝；可选字段必须有显式默认值。
- request/response 使用 `requestId` 关联，重复 response 必须幂等。
- 协议版本不兼容时在修改任何状态前失败。
- 任意等待阶段每 5 秒至少输出一次 `heartbeat` 或 `progress`。

## 8. 用户参数与计划预览

Agent 只收集必要业务字段：

- `spaceMode`: `create` 或 `existing`。
- `spaceName` 或 `spaceId`。
- `agentName`。
- `permissionPreset`: `viewer`、`editor` 或 `full`。
- `approvalMode`: `always-review` 或 Space 允许时的 `scoped-auto-publish`。
- `sourcePaths`: 默认当前工作目录，可多选。
- `sourceType`: 默认 `auto`，也可为 `code`、`documents` 或版本化 Adapter ID。
- `initialSync`: 完整 onboarding 默认必须为 `true`；轻量连接使用单独的 remote-only/connect-only 入口。

邮箱、密码、Google 登录信息、人类 token、Agent API Key 和 installation code 不进入表单协议。

Preflight 在第一次业务确认前完成，并将结果汇总为一份用户预览。内部把它拆成两个 hash 独立的部分：

- `serverPlan`：Space、Agent、Grant、Scope、审核模式和安装版本；只把这一部分发送给 bootstrap。
- `localPlan`：Agent 配置 diff、扫描绝对路径、Adapter、忽略规则、备份与本地恢复策略；只保存在本地 session，绝不上传。

用户看到的是两部分合并后的同一份预览，其中包括：

- Agent 类型和版本。
- Node/npm 与本地包版本。
- MCP 配置路径和写权限。
- 已有 AgentWiki MCP 项及替换/保留策略。
- 将创建或复用的 Space、Agent、权限和审核模式。
- 将扫描的绝对路径、Adapter、文件边界和忽略规则。
- 将写入的配置差异、备份位置、预计网络操作和恢复策略。

用户只确认一次接入计划。首次知识同步仍必须单独确认内容预览，这不与接入计划确认合并。

## 9. MCP 安装状态机

```text
collecting_input
→ waiting_for_web_auth
→ preflight
→ waiting_for_confirmation
→ bootstrapping
→ installing_gateway
→ verifying_gateway
→ scanning
→ waiting_for_sync_confirmation
→ syncing
→ completed
```

终止状态：

- `failed_recoverable`: 网络中断、授权过期、需重启 Agent、远程服务暂不可用。
- `failed_terminal`: 包校验失败、权限拒绝、协议不兼容、确认后配置被并发修改。
- `cancelled`: 用户主动取消。

### 9.1 安装事务

1. Preflight 读取并 hash 当前 Agent MCP 配置。
2. 用户确认包含配置 diff 的 plan。
3. bootstrap 返回一次性 installation code。
4. 安装 Skill 和固定版本 gateway 命令。
5. 对 Codex、Claude Code 使用明确非交互参数；对 OpenCode 使用原子 JSON 写入。
6. 写入前创建同目录备份，临时文件 `fsync` 后原子替换。
7. 若配置 hash 已变化，停止并要求重新预览，禁止覆盖并发修改。
8. exchange 后把 Credential 写入独立 `0600` 文件；不写 Agent MCP 配置、项目目录或日志。
9. 直接启动 gateway 子进程，完成 MCP `initialize`、`tools/list`、本地测试工具和远程身份/权限检查。
10. 任一步失败都恢复原 MCP 配置；未正式使用的 installation code 或 Credential 被撤销。

### 9.2 防卡死规则

- 所有包安装使用精确版本和非交互参数；不存在安装阶段 OTP/password prompt。
- 包下载默认 deadline 为 3 分钟，单条客户端配置命令 60 秒，MCP initialize 30 秒，远程 handshake 30 秒。
- Adapter 长任务使用独立 deadline 和持续 heartbeat；取消必须终止整个进程组。
- 超时只允许有界重试，并返回结构化错误，不无限等待。
- 当前 Agent 不支持 MCP 热加载时，gateway 子进程验证完成后返回 `reload_required`，脚本正常退出或继续直接执行首次扫描，绝不等待宿主刷新。
- onboarding session 持久化后才能进入下一状态；崩溃后从最后一个完整 checkpoint 恢复。

### 9.3 Agent 配置迁移

- 完整 onboarding 的目标 MCP 名固定为 `agentwiki`。
- 若已存在本项目生成的远程 AgentWiki MCP，Preflight 在计划中提出原子替换为本地 gateway。
- 若发现未知来源的同名配置，不自动覆盖；计划必须展示差异并取得确认。
- 其他名称的旧 AgentWiki MCP 会在计划中列出，默认禁用重复连接，避免工具重复；用户可选择保留轻量远程入口。
- `0.2.9 connect` 继续可用；`0.3.0 onboard` 是完整新流程。
- 旧本地 orchestrator 工具保留一个小版本周期的 alias，调用时返回迁移提示。

## 10. 本地 session 与恢复

非敏感状态保存于：

```text
~/.agentwiki/onboarding/<sessionId>.json
```

文件权限固定为 `0600`。内容包含状态、输入字段、plan hash、资源 ID、MCP 配置 hash、job ID、preview hash 和恢复提示，不包含密码、人类 access token 或明文 Agent API Key。

恢复命令：

```bash
npx --yes @neomei/agentwiki-local-sync@0.3.0 onboard resume <sessionId> --protocol ndjson
```

恢复规则：

- Device Auth 过期只重新授权，不重复收集业务字段。
- bootstrap 使用幂等键，不重复创建资源。
- bootstrap 响应丢失时，在 token 有效期内使用相同幂等键读取原结果；token 过期后通过已授权用户重新执行 Device Auth，并按 server plan hash 恢复，不重复 mutation。
- gateway 已验证时不重复安装。
- 扫描 checkpoint 完整时从下一个 work item 继续。
- 同步失败保留 preview Bundle；重试前重新 Pull 并检查 Revision。
- 用户取消时清理未使用安装凭据，保留最小审计记录和可读取消报告。

## 11. 错误模型

所有失败事件至少包含：

```json
{
  "type":"failed",
  "code":"MCP_HANDSHAKE_FAILED",
  "retryable":true,
  "resumeSessionId":"...",
  "nextAction":"重新运行相同命令"
}
```

稳定错误码包括：

- `AUTH_DENIED`
- `AUTH_EXPIRED`
- `PROTOCOL_UNSUPPORTED`
- `CLIENT_UNSUPPORTED`
- `CONFIG_NOT_WRITABLE`
- `CONFIG_CONFLICT`
- `PACKAGE_INTEGRITY_FAILED`
- `MCP_HANDSHAKE_FAILED`
- `TOOLSET_MISMATCH`
- `REMOTE_UNAVAILABLE`
- `SCAN_FAILED`
- `CONFIRMATION_REQUIRED`
- `PREVIEW_CHANGED`
- `SYNC_CONFLICT`
- `SYNC_FAILED`

错误文本、doctor 输出和最终报告统一经过现有敏感信息脱敏器。

## 12. 完成状态与报告

完整 onboarding 只有在以下条件全部满足时返回 `completed`：

- Device Auth 已批准。
- Space、Agent、Grant 与 Credential 已创建或复用。
- 本地 gateway 配置已原子写入。
- gateway 子进程可启动并完成 MCP handshake。
- 本地、远程和组合工具清单符合兼容 manifest。
- 远程身份、Space Grant 和有效 Scope 检查通过。
- 首次本地扫描和知识预览成功。
- 用户明确确认同步预览。
- 首次同步成功并返回服务端 Revision/ChangeSet 状态。
- 测试资源、临时进程和临时文件均已清理。

若仅宿主 Agent 需要重启，流程可返回 `completed` 且报告 `agentReload: required`；因为 gateway 本身已经由独立子进程验证。重启后 Agent 调用 `onboard_status` 读取相同 session 的结果。

## 13. 测试策略

### 13.1 单元与契约测试

- NDJSON 编解码、requestId、序号、默认值、未知字段和 stdout/stderr 隔离。
- 状态机全部状态、checkpoint、resume、cancel 和重复输入。
- Device code 哈希、过期、限流、拒绝、重复轮询和 token 单次使用。
- bootstrap plan hash、幂等键、权限模板和重复资源复用。
- 本地、远程和组合工具的注册表与确定性路由。
- 远程 manifest 缓存、版本协商、工具冲突和离线行为。
- Credential、日志、错误和报告脱敏。
- MCP 配置原子写入、并发 hash 检查、备份和回滚。

### 13.2 客户端安装测试

在隔离 HOME 中覆盖：

- Codex MCP add 与重复安装。
- Claude Code user-scope MCP add 与重复安装。
- OpenCode 各支持版本的配置结构与原子写入。
- 已有 direct MCP 替换、未知同名配置拒绝、并发配置修改。
- 不支持热加载时返回 `reload_required`，进程不挂起。
- 安装包下载超时、命令超时和整个进程组回收。

### 13.3 集成与 E2E

- 浏览器注册、登录、允许、拒绝、过期和 CSRF。
- 从一条命令开始的真实 NDJSON Agent 驱动流程。
- 真实 codebase-memory 代码扫描。
- 真实 MarkItDown 文档扫描。
- 本地 preview、第二次确认、服务端 Push、Revision 和 ChangeSet。
- 远程网络在扫描后断开，恢复后继续同步。
- 两次执行相同 onboarding 不产生重复 Space、Agent、Grant 或 MCP。
- Codex、Claude Code、OpenCode 至少各完成一次干净 HOME 安装验收。
- 生产受控 E2E 使用一次性用户和资源，并在 `finally` 清理。

## 14. 验收标准

- 用户只把一条命令交给 Agent。
- 密码和网页登录信息不进入 Agent 上下文。
- Agent 通过 schema 填空，不需要解释自由格式提示词。
- 正常流程只有网页 Auth、接入计划确认和首次同步预览确认三个用户动作。
- Agent 只连接一个本地 `agentwiki` MCP。
- 任意工具都由网关确定性选择执行平面，Agent 不选择 MCP server。
- `knowledge_prepare` 不上传原始内容或未确认 Bundle。
- 每个外部操作有 deadline；任意等待每 5 秒至少有一次状态事件。
- 当前 Agent 需要重启时流程正常结束，不无限等待。
- 任意退出都有 `completed`、`failed_recoverable`、`failed_terminal` 或 `cancelled` 结构化结果。
- 中断后使用 session ID 能继续，且不会重复创建或覆盖资源。
- 生产 E2E 同时验证统一工具清单、本地扫描、预览确认和首次同步。

## 15. 实施边界

本设计可拆成四个顺序里程碑：

1. Device Auth、bootstrap 和 NDJSON 协议。
2. 单一 gateway MCP、工具注册表、RemoteMcpBridge 和版本协商。
3. 原子客户端安装、状态机、checkpoint、resume 和报告。
4. 高层组合工具、首次扫描/同步、三客户端与生产 E2E。

每个里程碑必须先写失败测试，再实施；必须分别通过测试、类型检查、lint、build、敏感信息扫描和代码审查。未通过真实 Agent 安装与生产受控 E2E 前，不得在首页或使用指南中宣称完整自助接入可用。
