# Task 3 独立审查

审查提交：`effdecdf0f0f1f832830b5d30344551cc007e91c`，父提交 `a7bb3a3fd843abc94da71883f92627b382c8ca4d`。输入差异 SHA-256：`1fe3d0d712d07bc7688e4ca958014722abfcf2a365552f2d798a679c667691b4`。

依据：task-3-brief、constraints、task-3-report、task-3-review.diff，以及原报告 #7/#14/#15/#20。代码和调用链通过固定提交 `git show` / `git grep` 核对，未把工作区后续修改纳入结论。CodeGraph 无可用索引，按指令跳过。未修改产品代码、未启动子代理、未操作 UI 或生产、未重跑已有测试。

## 规格结论

**需修复后通过。** #14、#15、#20 的代码实现符合本组要求；#7 对页面等常见工具已有实质改善，但现有工具仍有可获得的目标和业务结果被丢弃，不能据此关闭整项。

| 原报告 | 审查结论 | 依据 |
| --- | --- | --- |
| #7 活动日志 | 部分符合；见 P2-1、P2-2 | 新日志已有工具名、部分业务 ID、有限结构化摘要和历史诚实回退；任务看板/关系目标及协作业务结果尚不完整 |
| #14 来源诊断 | 代码符合 | 实际服务端 `failureResult` 保存 `result.failure.stage/code`，Remote 错误保存 `sourceMetadata.statusCode/finalUrl`；客户端读取这些字段，缺失阶段不从 terminal `run.stage` 猜测 |
| #15 长地址 | 代码符合 | 完整 URI 保留，新增 `break-all` / `overflow-wrap:anywhere` 和原样 clipboard 写入；390px 实际溢出留给主任务 UI 验收 |
| #20 归档恢复 | 代码符合 | 列表与设置入口、二次确认、保留关联和审计的说明、归档发现过滤、仅恢复为暂停均已实现；鉴权/事务检查见下 |

## 质量结论

**With fixes：0 Critical、2 Important（P2），未发现新增归档路径的越权、审计丢失或状态竞态缺陷。** 两个问题均影响本次明确修复的 #7，建议补齐后再合并放行。

### P2-1：真实工具的任务/关系目标被通用字段表降级成 Space

- 位置：`agentwiki/apps/server/src/mcp/mcp.service.ts:635-639`。
- `mcpAuditTarget` 只识别 noteId/pageId/runId/sourceId/changeSetId/folderId/spaceId，既不接收 action，也不识别已有工具的 `taskId`、`sourcePageId`、`targetPageId`。
- 实际可达调用：`update_taskboard_status` 的 schema 明确接收 taskId（`mcp/taskboard-tools.ts:26-35,69-74`）；`propose_relation` 明确接收两个页面 ID（`mcp.service.ts:360-368`）。这两类调用经过同一个 executeMcpCall，但最终都记为 Space。因此同一空间内两个不同任务更新或两组页面关系操作，在活动记录中无法区分具体对象，违背 #7 的操作目标要求。这不是历史数据缺失，也不是无目标参数的全局工具。
- 建议：按注册工具或 action 提取已知的业务目标；保留任务 ID 的实际格式/长度契约，以及关系两端页面 ID；继续避免正文、标题、query、session/lease 秘密进入审计。增加实际注册 handler 路径的目标断言，覆盖同一 Space 不同任务/关系。

### P2-2：协作与任务看板的实际结果结构不在摘要提取范围

- 位置：`agentwiki/apps/server/src/mcp/mcp.service.ts:643-662`，以及客户端同步过滤 `agentwiki/apps/client/src/features/agent/AgentDetail.tsx:107-114`。
- 提取器只读取顶层 status/count 等字段；现有 `collaboration_next_action` 的业务结果是顶层 `action`，`collaboration_submit_result` 是 `action` / `artifactStatus` / `taskStatus` / `runStatus`，其中 `submitted` 与 `repair_result` 都是正常返回（协议 `packages/sync-protocol/src/collaboration.ts:614-655`）。`update_taskboard_status` 则返回 `{ task: { status, ... }, board_updated_at }`（`project-taskboard.service.ts:160-184`）。这些短小、合法、结构化返回全部会退化为 `{ response: 'returned' }`。
- 用户因此无法从活动记录判断提交已受理还是要求修复，也无法确认任务变成了什么状态；两类实质不同结果会同样显示“成功 · 结果摘要：响应已返回”。这恰是 #7 所需补充的业务结果，而非超限正文的合理回退。
- 建议：按工具的已知输出契约抽取安全枚举字段和计数，至少覆盖上述协作分支、task.status 及现有看板导入计数；客户端 allowlist 和中英标签同步扩展。不要通过保存任意返回对象来修复。测试使用实际 handler 返回形状，明确区分 submitted/repair_result 及不同任务状态。

## 已核对的关键边界

- **归档鉴权**：AgentController 类级 `JwtAuthGuard, HumanOnlyGuard` 覆盖新增路由（controller:12-14,41-48）；getOwned 校验 owner/revokedAt（service:67-96），事务内再次按 id/ownerId/revokedAt 查询（113-127）。普通 PATCH DTO 只允许 active/paused，且全局 ValidationPipe forbidNonWhitelisted；archived 状态不能经 PATCH 直接恢复。
- **事务/竞争**：update 与 setArchived 均先锁 User、再锁 Agent、随后重读状态；与 revoke 的同序锁及 live-agent-authorization 的同序 NO KEY UPDATE 锁兼容。归档先提交则随后的 PATCH 状态操作拒绝；PATCH 先完成则归档覆盖为 archived；并发 revoke 后的重读拒绝恢复。归档/恢复状态与 agent.archive/restore 审计处于同一事务，审计写失败将回滚状态。重复归档直接返回，不重复追加成功事件。
- **历史保留**：新增方法只更新 Agent.status 并追加事件，不删除 Grant/Credential/Audit，也不改 owner、revokedAt、凭据哈希、有效期或空间策略。restore 只到 paused；后续连接认证和 live Grant 授权继续要求 active（auth.service:119-128；authorization.service:438-448,470-482）。这里确认的是源码行为，并非真实数据库并发或在途请求中断的实测。
- **日志脱敏**：新摘要只保留枚举/计数/布尔值，JSON 文本解析上限 65,536 字符；未持久化 title/content/query/原始错误。技术详情使用 allowlist，credentialId 继续留内部关联但不渲染。历史 HTTP MCP 事件明确称连接请求，缺失摘要明确回退，没有伪造历史工具结果。上述 P2 需要在维持此边界的前提下修复。
- **诊断来源**：SourceService 的 RemoteSourceError.stage 固定 fetching；HTTP 状态来自 error.response.status；failureResult 保存结构化失败（source.service:115-132,830-873,929-947）。客户端 code/stage allowlist 和 URL 移除 userinfo/query/hash 与这些真实字段一致；不渲染 run.error 或任意 failure 扩展属性。未知 INGEST_RUN_FAILED 保持泛化而未伪造原因。
- **UI 确认**：AgentArchiveDialog 使用现有 ModalDialog，取消不请求、savingRef 防重复提交、关闭禁用、失败显示安全提示，卸载后不调用 onChanged/onClose。恢复说明要求检查权限后显式恢复运行。

## 证据与剩余验收

已阅读实现回执：client 5 文件 / 77 项、server 6 文件 / 112 项、类型检查和本组 lint 通过。此次审查未重跑，亦不将 mock 事务测试当作真实数据库回滚/并发收据。

主任务仍需完成固定修复候选的 DB/API 并发、原账号日志/失败来源、归档与恢复 UI、窄屏地址实际布局验收。它们与代码审查和最终发布事实分别记录。
