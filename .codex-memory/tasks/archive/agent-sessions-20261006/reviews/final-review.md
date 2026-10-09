# Agent Sessions — independent final feature review

- Reviewer: `sessions_final_review`，独立整体审查；未派子代理。
- 冻结范围：`ee9348839924fd7566ff3b67fa72beb6090a77ea` → **`5d6c6bad6b6580490326f63d680d60e0b223db89`**。
- 完整 review package：`review-ee934883..5d6c6bad.diff`，5623 行，SHA256 **`0374364b44f2248ddb242bd44094d8b4a4f9b3409e7c4057ce05290e7e1b0f81`**。
- 已分段读完完整冻结 diff（含全部测试、迁移、文档及 gate 变更）；输出截断的短段另行补读。另读 spec/plan、Task1/Task2 报告和全部复审回执、当前交接信息，以及具体相关的授权/锁、候选接受、笔记状态转换、CLI 关闭处理和编辑器应用/保存周边。
- 产品 checkout、index、HEAD 只读；没有启动/重启服务、重跑测试套件或构建，没有数据库写入或外部模型调用。只新增本报告。协调器四份 dirty 记忆文件不属于本次冻结产品判断。

## Strengths

- 后端使用一套 `AssistTask` 租约队列，新增持久会话而未引入第二执行器。请求幂等键、User → Space → session 锁及部分唯一索引共同覆盖同会话并发；worker graph 的会话依赖已在最终候选注册。
- 当前用户/Space 及全部历史来源在读取、发送、执行、进度和结果发布时重新校验；引用内容由服务端获取。不可访问会话按条从列表排除，直接读取仍失败关闭；旧 task list/get 和 Socket relay 均排除 session 数据。原有页面授权模型与这些检查一致。
- 不可变原始页面/引用/批注进入有界历史重放；最新正文没有替换历史快照。问答与提案权限、返回值和范围校验分开。取消信号贯穿 router/CLI，进度与 done 写入有 status/owner/lease 栅栏，取消后不能触发 fallback 或发布迟到成功结果。
- 极小 eager registry 与 lazy panel 保持现有首屏预算；候选最终仍经过实际 `PageEditor.applyAgentChanges` 和 `applyCandidateToDraft`。正式 Save 的 expectedUpdatedAt 及现有守护没有被绕过。历史接受 ledger 防止 Undo 后把同一 hunk 再次当新接受操作。
- 阅读选区采用 renderer 实例和精确源 offset，拒绝跨嵌入/生成文本的猜测定位；明确选中的笔记才进入 composer，Send 后才上传。R1–R4 的最终修复均存在且对应测试与独立回执可追踪。

## Issues

### Critical (Must Fix)

无新增 Critical 问题。

### Important (Should Fix)

### F1 · P2 — Send 响应期间切换读写路由会丢失已上传笔记的任务关联及 composer 消费

**位置：** `agentwiki/apps/client/src/features/agent-session/useAgentSession.ts:135–140`；对应 mount 栅栏为 `:51,64,80`，第二层旧页面回调栅栏为 `AgentSessionPanel.tsx:103–106`。

**触发：** 同账号、同 Space、同文章，在阅读态 stage 一条私人笔记并显式 Send(proposal)。在 turn POST 尚未返回时进入该文章编辑页。服务端已创建 turn；新 mount 正常读取 queued/done 历史。

**问题：** 读取响应的 mount/epoch 栅栏也被用来丢弃发送操作的成功事实。卸载旧 bridge 后 `valid(epoch)` 永远为 false，代码在 `onSent` 和 `updateDraft` 之前返回。新 bridge 能恢复候选，但只有成功回调拥有 `dispatchRequest`，历史 ready 恢复又要求本地笔记已经有对应 `taskId`，因此此笔记没有可恢复的关联。即使只放开 hook 的 return，旧 `AgentSessionPanel` 的 mount 栅栏仍会跳过 dispatch；不能通过移除单一安全判断解决。

**实际定向复现：** 使用真实 `AgentSessionPanel`、registry、`useAgentSession`、`usePersonalNotes`、选区/笔记存储 helper 和 `applyCandidateToDraft`，仅隔离 HTTP transport、认证/语言与不相关展示。POST 被延迟，read → edit 重建后返回合法成功结果，新 panel 轮询到 Done。结果：

```json
{
  "probe": "inflight-send-read-to-edit",
  "afterSuccess": {
    "status": "pending",
    "taskId": null,
    "composer": "Please discuss the questions in these annotations.",
    "historyShowsDone": true,
    "postCount": 1
  },
  "afterAccept": {
    "status": "pending",
    "taskId": null,
    "content": "ONE\nkeep\ntwo\n"
  }
}
```

**影响：** 已成功上传的笔记仍显示 Pending，发送内容仍显示在 composer；历史候选可成功修改该 quote，但笔记无法进入 Awaiting review/Resolved。这是要求内的跨读写/跨页连续对话路径，区别于已有 R2 的“发送前重建”及 R4 的“同 mount 内发送期间改稿”。无跨账号泄漏或自动 Save 的证据。

**修复建议：** 将成功发送的 receipt/不可变 source proof 与原会话请求身份绑定，交由 user+Space registry 持有并向当前匹配的 notes bridge 安全交付；仅消费原发送请求对应的 composer。保留账号、Space、page、session、note IDs、保存版本和原始快照校验，不能直接允许旧 mount 回调写当前页面。服务端成功必须能在同一授权身份的 route remount 后被对账，错误/撤权或切换身份不能借此绑定笔记。

**验收：** 真实生产 panel+registry+notes 的 deferred POST 覆盖 read→edit 和离页→返回两种情况：成功只创建一条 turn，原 composer 被恰当消费、笔记绑定该 task，ready 后 Awaiting review，实际 quote 覆盖接受后 Resolved；未选择笔记不变，无 PATCH。保留失败 Send、错误 canonical snapshot、账号/Space 切换及 stale source 的负例，补一次对应浏览器路径。

### F2 · P2 — 冲突后的 Regenerate 会重新上传笔记，但未把未解决笔记关联到新任务

**位置：** `agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:117–124`；冲突点为 `agentwiki/apps/client/src/features/page/usePersonalNotes.ts:81–82`，后续 task 恢复限制在 `:104–110`。

**触发：** 给选文 `one` 的笔记发送 proposal，turn-1 完成后笔记处于 Awaiting review。离开页面，带一处选区外的人工追加返回编辑页；原候选因 remount 全文差异显示 Conflict。点击产品提供的 **Regenerate from current draft**，原 selection 仍有效且保存版本未变，再显式 Send。turn-2 完成后接受其覆盖 `one` 的候选。

**问题：** `regenerate()` 复制原 `noteIds`/`annotations` 到新请求，却没有建立显式再生成的旧任务→新任务关联。`usePersonalNotes` 对任何非 Pending 笔记都拒绝 dispatch，因此在完整成功的 POST 回调里也不绑定 turn-2；ready/accept 对 turn-2 又因笔记仍绑定 turn-1 被拒绝。此问题不需要 F1 的在途切路由，第二次 Send 和响应始终在同一 mount。

**实际定向复现：** 同样采用真实生产 panel/registry/notes/应用 helper。第一轮已完整成功；重建后使用界面提供的 regenerate。第二次 POST 确实带原 note ID，第二候选接受成功，人工追加保留：

```json
{
  "probe": "regenerate-unresolved-note-after-remount",
  "initial": { "status": "awaiting-review", "taskId": "turn-1" },
  "postCount": 2,
  "lastTurnNoteIds": ["the-original-selected-note-id"],
  "afterSecondAccept": {
    "status": "awaiting-review",
    "taskId": "turn-1",
    "content": "ONE\nkeep\ntwo\nManual end\n"
  }
}
```

上面仅将随机 note ID 替换为可读占位名；状态、任务与正文为实际 probe 输出。

**影响：** 明确重新生成并成功接受真正覆盖 quote 的修改后，笔记仍永久等待旧候选审阅。再生成入口承诺保留原批注上下文，但实际成功上传后 silently 拒绝关联；用户必须自行猜到先去笔记队列 Reopen，再 stage/send 一次。既有“冲突再生成”与“笔记接受覆盖”各自通过并不能覆盖这条组合路径。

**修复建议：** 对明确再生成的未解决笔记引入可验证的 supersession/reopen 流程：仅允许原关联 task 与同 user/Space/page、原始批注和发送源证明一致的选中笔记迁移到新 task。或在发送前明确要求并提供可操作的 Reopen，不能先成功上传再静默丢弃关联。不要放宽任意非 Pending 笔记的 dispatch guard；Resolved 笔记不能被普通历史重放自动重新打开，旧任务的迟到 ready/accept 也不能解决已转入新任务的笔记。

**验收：** 生产集成测试覆盖 turn-1 Awaiting review → remount/安全人工改稿导致冲突 → regenerate → turn-2 成功 → quote 覆盖接受，最终仅选中笔记正确解决且人工改动保留。失败第二次 Send 保持可恢复状态，旧 task 迟到事件、其他 task/账号/Space/未选笔记全部拒绝。浏览器复验应使用 UI 的 regenerate 入口，不以手工预先 Reopen 的路径代替。

### Minor (Nice to Have)

无新增需要单列的问题；未将既有 lazy chunk/circular chunk 构建提示或未实施的后续 ACP 能力列为本轮缺陷。

## Plan alignment and integration assessment

- **Task1：符合计划。** 持久 API、live 权限、引用解析、历史窗口、单活跃任务、问答/提案分离、取消/发布栅栏和 runtime port 均实现。此次整体核对未发现新的后端阻断项；先前四项 Task1 finding 已有最终代码及回执支持。
- **Task2：主体符合，F1/F2 尚需修复。** 阅读/编辑共用 UI、显式附件、原文映射、历史版本、候选保护和逐项 Undo 均有源码和测试/实际 UI 回执。缺口集中在持久会话与本机 notes bridge 的两个生命周期交界，不是扩展新的产品范围。
- **Task3：多数验收已完成，最终 gate 尚未通过。** 真实 API/worker/CLI/DB 与 UI 的分项证据齐全；本次两项具体缺陷需要修复与独立复审。owned runtime 清理、最终交接归档由协调器在该 gate 之后完成。
- **Backward compatibility：** 旧任务 nullable session、默认 proposal 保留，旧服务返回值改为显式白名单；session 不能经旧 API/socket 旁路取得。既有用户/Page SET NULL 与新 session CASCADE 的迁移约束没有矛盾。没有新增依赖或更改预算上限。

## Migration and authorization verification

- 新 SQL SHA256 独立重算为 **`4eb3800ffc053830ab75ece50643d10d2224fa5d704f62364f1fb0d7553df690`**；SQL/Prisma 的字段、默认值、索引和 FK 一致，active-turn 部分唯一索引是有意的 Prisma 表达范围外约束。
- 只读重算现有 migration corpus：**61 files，`39e27b72da1e030c676cb858b642c3f231d6ddc4d5f531b7f4749f45c9ced7a5`**，与已独立批准的 SQL/corpus 及两处 gate 常量一致。冻结 diff 只新增该 SQL，gate 只改 hash，未改变 allowlist/保护逻辑。
- 实际 `AuthorizationService` 的 Page 人类访问依赖当前 Space 权限；新服务的同 Space/未删除 Page 校验与现行模型相符。User row 与 Space advisory 锁顺序相符，引用/历史来源删除或移出 Space 后失败关闭；没有把网页会话授权扩展成 MCP credential/grant 权限。
- 初始 package 基线与 HEAD 已核实；不把未来部署需要的迁移应用/回滚运维步骤冒充已部署事实。

## Checks and evidence

本 reviewer **未重跑**已有成功套件；以下为实际读取的 coordinator/implementation receipts，按候选区分：

- 后端最终 `server-after-fix.log`：**159 passed suites，2877 passed，26 existing skipped**，对应后端 `b5e80d7a`。
- 前端完整 `task2/client-final.log`：**138 suites，2051 passed**，属于 `29366ae4`。最终 `5d6c6bad` 的 `review-r4-focused.log`：**7 suites，224 passed**，另有最终 typecheck/scoped lint/build 回执。
- 最终生产 build 明确为 **548914 / 550000 bytes**，未放宽 gate；最终 UI 使用 `index-DFir-slj.js`。
- `runtime-r2/http-db-receipt.json` 的 **13** 项实际 HTTP/worker/数据库检查全部通过，包括并发幂等/单活跃轮次、问答与提案、历史原始来源、长中文 stdin、删除来源/撤权及真实 CLI 终止。
- `ui-undo-receipt-latest.json` 明确记录两 hunk、人为编辑交错、三次逐字 Undo 和三次 Redo 全部通过。
- `runtime-r2/page-checkpoint-post-save.json` 证明显式 fixture Save 后 API 与 DB 一致、主页面正文精确匹配且版本前进，sibling 字节/版本未改。之前不自动 Save 的对应 checkpoint 在 UI 总回执中有明确记录。
- `ui-acceptance.md` 记录完整阅读批注→引用→Send→跨页历史→候选接受→Save 链路，以及 390 阅读工具栏修复、笔记覆盖接受/Undo 和最终 1280/1600 无溢出/无新增 console error。本人没有另行执行 CUA，不将这些 coordinator 回执说成独立浏览器重跑。
- **本 reviewer 新增验证仅两项：** 为 F1/F2 在 Node 内存中转译冻结工作树的真实组件/hook，使用 React Testing Library/JSDOM、受控 HTTP transport 和真实本地 note/target/apply helper。未创建测试文件、未修改产品/index/HEAD，未读取 runtime 凭据。两个 probe 都成功复现报告中的状态与精确正文结果。
- **明确边界：** 未加载真实 provider 密钥，deterministic fixture 经过真实 API/worker/CLI 的结果不能证明真实模型质量；ACP 只有接口契约，没有本机 connector 验收；无 push/merge/release/deploy。以上属于约定阶段边界，均不是 F1/F2 的替代问题。

## Recommendations

将 F1/F2 作为一次聚焦 notes/session 生命周期修复，保持既有身份、不可变来源、版本和接受覆盖保护；加入两条生产组件回归及对应 UI 验收后，独立复审修复差异。后端、迁移和已通过核心编辑器验收不需要为这两项客户端缺陷无理由重跑完整套件。

## Assessment

**Ready to merge? No — changes requested for F1 and F2.**

后端、迁移及候选写入边界整体可靠，已完成的测试和真实 fixture/UI 验收有明确范围。持久会话在两条合法用户流程中仍会丢失/滞留私人笔记任务关联，导致已上传、已接受覆盖修改的笔记不能走完生命周期；完成这两项修复和独立复审前不能关闭最终整体 gate。
