### Finding Verdicts

- **R1 · 恢复暂存请求时 selection/section 被扩大为 document — ADDRESSED。** `agentwiki/apps/client/src/features/agent-session/useAgentSession.ts:8` 将 targetKind 纳入每会话 Composer；`AgentSessionPanel.tsx:19`、`:33`、`:124`、`:174` 从同一 registry 保存/恢复暂存、再生成和显式范围选择，不再按 mount 初始化 document。成功 Send 才消费范围，失败保留：`useAgentSession.ts:140`。`AgentSessionPanel.spec.tsx:216` 覆盖两种范围的 remount、read/edit、跨页往返及会话切换，`:243` 验证 stale source 必须显式重选且无提前 POST，`:259` 验证成功发送后的跨页新追问使用新文档。controller 另已实际验证阅读选文 → stage → edit 后 selection 保留。
- **R2 · 跨 mount 的暂存笔记无法绑定成功发送的 task — ADDRESSED。** `agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:36`、`:105` 在成功 Send 后携带 scoped dispatchRequest，并使用返回 turn 的原始 page/snapshot/note IDs；`features/page/usePersonalNotes.ts:83`–`:100` 允许恢复 credential，同时校验身份、request、所选 note IDs、annotation body/quote 和源版本。`AgentSessionNotes.spec.tsx:40` 使用真实 panel + registry + notes hook 验证 stage → read/edit 或跨页 remount → Send → ready → 实际覆盖 hunk accept 的完整状态转换；`:55`、`:64`、`:80`、`:95` 覆盖失败/错误响应/身份切换/会话隔离。controller 已实际确认原路径 Send 后笔记变为等待审阅；其另行补做 quote 内部修改后的 resolve UI 不作为本次代码结论的替代证据。
- **R3 · 390px 阅读工具栏溢出 — ADDRESSED。** `agentwiki/apps/client/src/features/page/PagePreview.tsx:617` 删除 shrink-0，并增加 min-w-0 / max-w-full，让操作容器按可用宽度换行。controller 真实 CUA：documentWidth=390，五个按钮右边界均 <=374，页面信息/本文目录实际开关通过，Close bottom418、Send bottom828 位于844px高视口内。本 reviewer 已查看 `ui-reading-390-toolbar-fixed.png` 与 `ui-reading-agent-390-fixed.png`，与几何及操作回执一致。

### New Breakage in the Fix Diff

**R4 · Important / P2：发送期间继续人工编辑会丢失已上传笔记的任务关联。**

- 位置：`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:90`；后续请求清理位于 `features/agent-session/AgentSessionPanel.tsx:106`。
- 新增条件要求成功响应的 `candidate.baseContent === latestRef.current.source`。这里 latest source 是回调执行时的实时草稿，而 candidate.baseContent 是 Send 时已经冻结的快照。编辑器在 POST 期间仍允许正常人工输入，因此即使改动完全远离笔记 anchor，身份、saved version、note body/quote 与发送时快照均正确，dispatch 也会被拒绝。
- 随后 `onRequestHandled` 正常清空本地暂存请求，session send 也消费 registry 中的暂存内容；笔记却留在 Pending 且没有 taskId。后续 ready/accept 无法恢复，因为历史恢复要求已经存在相同 taskId。这与服务端已成功接收笔记的事实不符，并再次阻断笔记生命周期。
- 可复现步骤：编辑态给开头 `one` 创建并 stage 笔记；显式 Send 后延迟 turn POST 响应；在文末（远离该 anchor）人工追加一行，不 Save；返回合法成功响应。查看 note 状态及 taskId。
- 针对冻结修复的真实 hook 小验证结果：`{"send":"successful explicit Send","identityMatches":true,"versionUnchanged":true,"change":"manual append outside selected anchor","status":"pending","taskId":null,"requestCleared":true}`。验证使用 React renderHook；用原 review package 和本 fix package 在内存中重建本次 usePersonalNotes，实际项目 capture/resolve/storage/transition helper，未修改或创建产品/测试文件、未启动服务、未跑 suite。
- 修复建议：成功 dispatch 的来源证明应比对**发送瞬间捕获的不可变 snapshot**与服务端返回的 canonical snapshot，并继续核对当前身份、所选本地 note IDs、原始 body/quote 和版本等安全条件。当前草稿的后续人工变化应由候选接受阶段的原文/锚点/version guards 处理，不能使成功上传记录消失。不要简单删除 source 校验：现有“响应返回被篡改 source 不得绑定”的 negative case 仍须成立。
- 修复验收：真实 panel + registry + notes hook 测试以 deferred POST 重现；Send 期间追加无关正文，成功响应后只将选中笔记正确绑定 taskId/Dispatched，未选笔记保持 Pending，后续 ready/覆盖候选 accept 仍按实际证据转换。保留错误 returned snapshot、错误 user/Space/page/note、失败 Send 均不能绑定的测试；编辑期间不得自动 Save。

### Out-of-Scope Observations

- 无。本轮没有重新审查未触及实现，也没有扩大上一轮的三项 finding。

### Checks

- 冻结修复：Base `29366ae445ce3d159acb2a0d6f1a66195fcb0bb1` → Head `cbd5fc91a0d315c03dbe8fd99c6f9f5dac50c6e2`；唯一变更来源 `review-29366ae4..cbd5fc91.diff`，515 行完整读取，7 个产品/测试文件。首次输出截断后仅补读缺失范围。
- 沿用此前已完整读过的 Task2 brief 及原 findings，读取实施报告新增修复段，核对具体 tests 与 diff。
- 已读取 `/tmp/agentwiki-sessions-20261006/task2/review-focused-final.log`：9 suites / 270 tests passed，6.25s；typecheck 与 scoped lint 日志无错误；最终 build 成功，4.56s，报告首屏仍为548914 / 550000。现有 large lazy chunk warning 不是本次修复新增问题。
- 未重复完整或 focused suite、未构建、未启动服务、未修改产品/index/HEAD；只为新增 source-vs-live-draft 竞态运行上述单点内存验证。
- controller CUA 证明与 reviewer 的代码/测试回执判断分开；未将 fixture 结果描述为真实 provider、ACP connector 或部署验收。

### Verdict

**Fix round: Findings remain open — R4（本轮新增 Important/P2）。** 原 R1/R2/R3 均 ADDRESSED；修复新增的 Send 回调与人工编辑竞态需处理后再作 scoped re-review。
