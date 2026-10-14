# Task 3 回执：来源诊断与 Agent 管理

## 状态

已完成本组候选实现与定向测试，没有 stage/commit/push/deploy 或 UI 操作。root 继续隔离 DB/API + CUA 验收及整合。未修改共享 messages.ts、review、graph、editor。

CodeGraph 首先尝试 `codegraph explore "Sources page failure diagnostics URL display, Agent detail activity logs, agent archive delete endpoints, MCP audit tool result logging"`；工作树 `.codegraph` 只有 `.gitignore`，CLI 报没有索引。依规定没有创建索引，随后沿源码定位。

**无需数据库迁移**：Agent.status 已是 String，archive 使用 `archived` 状态，不新增数据库列/枚举；审计目标/结果摘要使用现有 resourceType/resourceId/metadata JSON 字段。

## #7 活动记录

根因：`AgentAuditInterceptor` 写 transport GET/POST /api/mcp 审计；`McpService.recordMcpCall` 虽已有 mcp.tool.*，其 resourceId 固定工具名，metadata 仅参数名/credentialId。`AgentDetail` 不展示真实目标或结构摘要，技术详情只删 credentialId，其他任意 metadata 会直接显示。

实现：
- MCP 工具审计从 noteId/pageId/runId/sourceId/changeSetId/folderId/spaceId 中按优先级取合法业务 ID（字母数字、下划线、横杠，1–128 字符），记录资源类型+真实 ID。
- 有上层 Space 但无更具体 ID 时记录 Space；没有目标参数时保留 McpCapability 工具自身，不能伪造目标。
- 成功结果只抽取枚举 status、非负整数 count/total/pageCount/changeItems、数组返回条数、hasMore；MCP JSON 文本最多解析 64 KiB，不存 title/content/query/name/token/原始错误。
- 未能抽取结构摘要时新记录明确写 response returned/error，历史缺字段显示“记录未保存结果摘要”。
- 列表显示工具名、真实类型/ID、结果和本地化 outcome；旧 HTTP /api/mcp 明确标为 MCP 连接请求、历史未保存具体工具或目标，不能把 transport success 宣称为工具完成。
- 技术详情 allowlist 资源字段、参数名、结构摘要，不展示任意 metadata/credentialId/token。

限制：历史审计无法补造工具/目标/结果；无参数目标的全局工具仍用工具自身。超 64 KiB 内容仅有明确的响应摘要；未新增正文分析以防泄漏。真实原账号日志最终回验由 root 做。

## #14 来源失败诊断

根因：SourceService 已在 run.result.failure 保存真实失败 stage/code，并保存 URL sourceMetadata 的 HTTP 状态/脱敏最终地址；IngestRunDetails 仅映射 Git code，terminal 状态隐藏了 stage，所有非 Git 错误降级泛化。

实现：
- 按 `result.failure.stage` 展示完成语态的失败阶段，不展示“正在抓取”；从 stale run.stage 不推断历史失败阶段。旧记录明确说明未保存阶段。
- 支持 8 种现有 REMOTE_* 错误；401/403/404/429/5xx 显示对应可读原因及 HTTP code。
- 提供地址/DNS、安全拒绝、HTTP访问、内容类型、大小、编码、重定向等可行建议，保留 SSRF/鉴权限制。
- 展开脱敏技术详情只显示 allowlist 的 code/stage/runId/httpStatus/finalUrl；URL 清除 username/password/query/hash。不渲染 raw run.error 或任意 failure 字段。

限制：未知 INGEST_RUN_FAILED 只结合已保存阶段和 code 给出安全泛化描述；未自动展示未脱敏原始异常，也未绕网站登录/防爬/SSRF 限制。现有历史缺字段无法恢复，原“百度”记录由 root 回读确认。

## #15 完整长 URL

根因：SourcesPage 详情把 uri 直接插入无 wrapping 的 inline `<p>`。

实现：拆成地址段，`break-all [overflow-wrap:anywhere] min-w-0`，完整 uri 保留；提供复制完整地址及成功/失败反馈。切换详情清除复制状态。

限制：DOM 验证 wrapping CSS 和真实 clipboard API 调用参数完全一致；原视口/390px 实际像素溢出由 root CUA 验收。

## #20 可恢复归档

根因：界面仅 pause/resume；已有 DELETE 是不可恢复 revoke（吊销所有凭据），不符合保留审计的优先可恢复归档方案。

实现：
- 增加人类 JWT + HumanOnlyGuard 原有 controller 下的 POST /agents/:id/archive、POST /agents/:id/restore；仅 owner，归档不删 Grant/credential/audit。
- owner -> Agent 锁序与现有授权/revoke 一致，事务重新核验 owner/revokedAt/status，状态变更及 agent.archive/restore 审计同事务；审计失败回滚状态。
- restore 仅从 archived -> paused，用户检查权限/连接后显式 resume；常规 PATCH status 对 archived 拒绝，防止绕过恢复入口，PATCH 本身也使用相同锁/事务，消除与 archive 并发恢复竞态。
- 原 live auth 仅允许 active，因此归档立即阻止后续连接/实时 Grant 写入；既有授权边界不改。
- GET /agents 默认排除 archived，避免协作/授权选择器继续提供闲置身份；管理列表显式 `?includeArchived=true`，通过“查看已归档智能体”恢复为暂停。
- AgentList 和 AgentDetail Settings 均有入口，同用 ModalDialog 二次确认；解释保留空间授权/凭据/审计和手动恢复流程。取消不请求；失败保留弹窗并显示可操作错误；保存中关闭禁用、mounted guard 防旧路由回执动作。

**不可改字段/边界**：不触碰 ownerId、revokedAt、凭据 keyHash/prefix/expiry、Grant role/scopes/folderScopes、空间审核策略、审计旧内容；不允许 PATCH 直接设置 archived 或把 archived 改 active；归档/恢复仅改 Agent.status，并追加审计。历史 credentialId 保留内部审计关联但不公开显示。不可删审计、不可伪造 API 归档能力，权限不放宽。

## 改动文件

- apps/client/src/features/agent/AgentArchiveDialog.tsx（新增）
- apps/client/src/features/agent/AgentList.tsx / AgentList.spec.tsx
- apps/client/src/features/agent/AgentDetail.tsx / AgentDetail.spec.tsx
- apps/client/src/features/source/IngestRunDetails.tsx / IngestRunDetails.spec.tsx
- apps/client/src/features/source/SourcesPage.tsx / SourcesPage.spec.tsx
- apps/client/src/i18n/bug-operations-messages.ts（新增；导出 bugOperationsMessages 与 bugOperationsText，当前组件直接用 helper，root 可把两语言对象 spread 整合共享 messages）
- apps/server/src/core/agent/agent.controller.ts
- apps/server/src/core/agent/agent.service.ts / agent.service.spec.ts
- apps/server/src/mcp/mcp.service.ts / mcp.service.spec.ts

## 验证

RED 已观察：来源失败阶段/REMOTE描述/历史缺阶段，MCP资源目标+摘要，归档方法/直接PATCH拒绝，Agent列表确认归档，活动目标+摘要，默认发现排除归档，HTTP403可读原因。

最终：
- `pnpm --filter @agentwiki/client exec vitest run src/features/agent/AgentList.spec.tsx src/features/agent/AgentDetail.spec.tsx src/features/source/IngestRunDetails.spec.tsx src/features/source/SourcesPage.spec.tsx src/features/source/RunsPage.spec.tsx`：5 文件 77 项通过（最后 02:06:37）。
- `pnpm --filter @agentwiki/server test -- --runTestsByPath src/core/agent/agent.service.spec.ts src/core/agent/agent.controller.spec.ts src/mcp/mcp.service.spec.ts src/core/auth/auth.service.spec.ts src/core/authorization/authorization.service.spec.ts src/core/authorization/live-agent-authorization.spec.ts`：6 文件 112 项通过（最后 02:05:44）。
- server `typecheck`、client `tsc --noEmit`：通过。初次碰到其他组 SpaceView.spec timer 类型问题，通知 root，后续重跑已通过。
- 本组全部 9 个实现/文案文件 eslint：通过。

未运行本组 build/生产 UI/真实 DB 并发；root 负责整体门禁与原账号操作读回。工作树共享任务其余文件变动不属于本组。

## 独立审查补修（基于 effdecdf，02:24）

审查发现 #7 实际工具覆盖缺口：update_taskboard_status 的 taskId 和嵌套 task.status 被通用提取器忽略；propose_relation 双端 sourcePageId/targetPageId 退化为 Space。

核实工具源码后补修：
- 目标提取优先识别 TaskboardTask taskId（沿实际接口允许 1–1024 字符的业务 ID；拒绝控制字符，不限为 CUID）。
- update_taskboard_status 只取 task.status，并使用 TASKBOARD_STATUSES 的七个合法枚举值，记录 taskStatus；完全忽略任务 title/current_step/正文等自由文本。
- 关系提案记录 PageRelation sourcePageId 作为 resourceId，并在 metadata.target 中记录 targetPageId；活动行显示两端 `source → target`，展开详情也只取合法两端 ID，不展示 relation 文本。
- 活动摘要新增七种看板状态的中英映射。未知/恶意 task.status 不展示，历史记录仍诚实回退。

新增 RED：7 种实际任务状态、两端关系目标、客户端任务状态与两端显示均在原候选上失败；修复后 server MCP+taskboard 2 文件 31 项通过，client AgentDetail 1 文件 19 项通过；双端类型检查通过，改动5文件 eslint通过（控制字符校验改逐字符charCode后重跑）。本次仅修改 mcp.service.ts/.spec.ts、AgentDetail.tsx/.spec.ts、bug-operations-messages.ts，未提交。

### 同轮补齐 P2-2（02:28 最终）

继续按 `task-3-review.md` 的完整两个 P2 执行，早先31/19项只表示任务/关系首轮补修，不能作为P2-2完整关闭。

- `collaboration_next_action` 按协议枚举记录 action（execute_task/waiting_dependency/waiting_human/paused/completed/failed/cancelled）及retryAfterSeconds。
- `collaboration_submit_result` 明确记录submitted/repair_result；artifactStatus/taskStatus/runStatus通过原协议enum schema核验；repair只保留repairsRemaining/issueCount，不保留issues.code/path/message。
- 协作replayed布尔保留，leaseToken/attempt凭据/自由文本完全排除；import_taskboard_plans只记录imported/failed计数。updateTodo的合法taskStatus也覆盖。
- 客户端同步allowlist、中英标签，submitted与repair_result分别显示“已提交”/“需要修复结果”，运行/成果/任务状态及导入数量可辨认。
- 使用真实registered handler测试：实际协作submit_result的submitted/repair_result两分支、next_action等待分支，真实taskboard import部分失败计数+update_status任务对象，真实propose_relation同Space两组不同页面对；不以仅直接调用提取器的测试替代handler覆盖。

最新验证：server3文件（mcp.service.spec / collaboration-mcp.spec / taskboard-mcp.spec）38项通过；client AgentDetail21项（包括中英业务结果与导入摘要）通过；两端typecheck通过，7个变更文件eslint通过。仅在前述5文件外增改collaboration-mcp.spec.ts/taskboard-mcp.spec.ts。无提交/数据库迁移/权限变化/旧审计改写。

### 最终审查协作顶层状态补修（2026-10-15 02:43）

新增P2经实际handler输出确认：collaboration_join_run/get_run返回顶层status，原通用enum未覆盖draft/waiting_review，running虽有status摘要却未规范为runStatus。

仅两文件修改：mcp.service.ts对这两工具使用CollaborationRunStatusSchema核验value.status→summary.runStatus，避免重复通用status；collaboration-mcp.spec.ts通过真实registered join/get handlers覆盖draft/waiting_review/running，分别断言安全审计与Agent审计拥有runStatus且不含页面正文。客户端已有完整runStatus中英文枚举无需修改。

RED：3参数场景均在补修前失败（draft/waiting_review=returned，running=status）；GREEN：MCP/collaboration/taskboard3文件41项通过；服务端typecheck、两文件eslint通过。未重build dist、未操作fixture、未提交、无数据库迁移或鉴权变化。
