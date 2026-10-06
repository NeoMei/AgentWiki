# f4325942 独立定向复审

结论：**只读代码复审通过；本轮范围未发现未关闭代码 finding。旧独立探针在固定候选上通过修复后断言。真实 UI 验收仍由 root 单独完成，本文不宣称实际键盘 Undo / 浏览器验收通过。**

## 身份与范围

- 候选：`f4325942c53101e8c628cd68fc1b7f23f07ae5cd`；比较基线：`1735f341167950e58dca935b819bc2e188133f88`。
- 工作树：`/Users/neomei/.codex/worktrees/document-workspace/AgentWiki `，字面尾空格；所有 Git 操作显式指定该 `--work-tree`，未改 core.worktree。
- 当前 HEAD 是 `aff013bfd7507c3a0e2c2060bc607cc3f1fa28d3`。已核对候选到 HEAD 仅交接/计划文档变化，生产源码与测试相同。独立执行副本由 `git archive f4325942... agentwiki/apps/client` 创建，避免将后续文档提交混作候选。
- 完整比较还包含任务归档/计划文档；修复的 source/test 范围确为五个文件：usePersonalNotes.ts、usePersonalNotes.spec.tsx、AgentAssistPanel.tsx、AgentSessionPanel.tsx、AgentSessionNotes.spec.tsx。
- 先读 brief、task-1-review、task-1-report；另直接检查五文件 diff 及事件/权限/候选/状态转换调用链。未调用 CodeGraph，未使用浏览器、DB、运行时服务端口或凭据，未改产品代码。

## 针对原缺陷的判断

旧独立证据 `mixed-note-probe.log:29-32` 明确记录正文已变成 `one\nkeep\nTWO\nManual end\n`，第一条为 `resolved/sent-turn`、第二条仍为 `awaiting-review/sent-turn`。这比测试数量更直接证明原缺陷。

修复后，成功发送重生成回执先验证全量上下文，再仅迁移未解决项：

1. `usePersonalNotes.ts:80-90`：事件/候选 taskId 与当前 user/Space/page 相同；候选 IDs 和事件 IDs 等长、逐项一致且无重复；保存版本一致；每一个本地批注（包括 Resolved）必须存在，正文/quote/锚点保存版本与完整 canonical annotations 匹配，并能在候选基线原文定位。故不能通过过滤掉 Resolved 来绕过全量证明。等长加上逐个唯一事件 ID 能找到对应 annotation，亦排除了用重复 annotation 替代缺失项。
2. `:95-115`：successful-send credential 的 scope、request、目标与发送时 source/title/version 仍验证；supersedes 必须指向不同任务、相同保存版本/title、完整 IDs/annotations，并在旧快照定位所有锚点。非 Pending 的未解决项必须仍属于 supersedes.taskId，错误旧任务不能转移。
3. `:118-122`：只对 unresolved IDs 调用 reopen，all-Resolved 直接退出。随后保留全量 binding IDs，交由 Pending-only dispatch 更新新任务。`reviewComments.ts:42-51` 保持 task fence，故 Resolved 完整记录/旧 taskId 不变。
4. `:126-148`：重挂载恢复必须至少有一项属于当前任务，全部未解决项都属于当前任务；允许已经验证的 Resolved 保留历史任务。coverage 只计算绑定本任务的本地笔记；accept 要求真实覆盖非 uncertain 且所有覆盖 edits 都已接受。无关 hunk 不足以解决另一项。旧 ready/accept/fail/discard 在重新绑定之后无法推进或回退新 task 的未解决项。

这也支持第二次重生成：turn 1 已解决项继续保留 turn 1，turn 2 的未解决项通过完整 turn 2 supersedes 证明迁移 turn 3；全量 context IDs 没有被截成子集，恢复不会因历史 Resolved 所有权不同而再次失败。

## 集成守护检查

- `AgentSessionPanel.tsx:45-46` 唯一 emit 从当前 canonical session.detail 以 candidate.taskId 取 annotations；dispatch/ready/failed/应用失败/accept/discard 均调用该 helper。session hook 没有将缺失证明回退成 composer 内容。
- `AgentSessionPanel.tsx:15-21,61-83` 的 receipt 同 session/user/Space/page 与 exact sent source/title/version/notes/annotations 核对仍在；发送回执与完整 canonical context 是两层独立证明。
- `useAgentSession.ts:53-66,87-94,149-168` 的当前 bridge lifetime/epoch、selected session、Space、授权读取、晚到 receipt awaitingRead 与 403 清除逻辑未修改。
- `agentSessionCandidate.ts:17-26` 重挂载绑定仍核对权限/身份/保存版本/title/expected draft；`AgentSessionPanel.tsx:87-98` 接受仍调用 guarded apply。新 notes 逻辑不写正文，不自动 Save，不修改 Undo 历史。
- `PageEditor.tsx:200,255,1354-1364` 仅 notesWritable 时提供有 scope 的 hook；writeUnavailable、错误页面、未加载、非当前授权用户均不能保留可写身份。
- Shared event 的 annotations 类型可选，session 模式运行时必需；legacy Assist 的默认 stageForSession=false，因此原事件形状仍兼容。

## 独立执行证据

为了避免仅采信实施方新测试，将此前独立 probe 原操作序列复制到新的固定候选 scratch，仅修改名称和预期状态：成功重生后第二项应 `awaiting-review/regenerated-turn`，接受后应 `resolved/regenerated-turn`。保留原两次 POST、接受第一项、精确正文 Undo 模型、跨路由、人工尾段、重生、接受实际覆盖及零 PATCH 断言。

- scratch：`/tmp/agentwiki-independent-acceptance-20261006.4eB3KG/f432-fix-review-3ks1hdue/agentwiki/apps/client`
- 成功命令：`node node_modules/vitest/vitest.mjs run src/features/agent-session/AgentSessionNotes.spec.tsx -t 'independent probe:' --reporter verbose`
- 日志：`f432-independent-probe-direct.log`。
- 结果：**1 passed，27 skipped**；实际记录：第一项 `resolved/sent-turn`，第二项 `resolved/regenerated-turn`；正文 `one\nkeep\nTWO\nManual end\n`；POST=2，PATCH=0。
- 初次 `pnpm exec` 启动触发 pnpm workspace 依赖检查，因 scratch 只导出 client、缺少 `@agentwiki/shared` workspace 清单而失败，测试未运行；日志 `f432-independent-probe.log` 保留。随后直接执行已有 Vitest CLI，避免该检查，并成功。未将启动失败算作产品缺陷或测试通过。
- Vite cache 显式放在本次 scratch；产品 Git status 在操作前后均为空。未跑额外全套测试、未访问应用运行时。

另直接检查新增生产组件用例的两种接受顺序、failed-send retry、消费 receipt 后真正卸载/重建 hook、第二次重生，以及 hook 的完整证明反例矩阵；代码覆盖了这些条件。本文不把实施方报告的 427 tests 作为独立执行结果。

## 边界与后续验收

本次 probe 的 Undo 是 byte-exact 正文恢复，传输/auth 使用测试 fixture；Panel、registry、notes hook 和 apply helper 为候选生产实现。它独立关闭旧组件探针中的状态链接失败，不能替代编辑器快捷键 Undo 与浏览器持久化/路由操作回执。root 仍需在真实 UI 验证原两批注场景：Resolved 历史记录保持；未解决项成功跟随新 turn，接受对应 hunk 后转 Resolved；人工尾段保留；无自动 Save。
