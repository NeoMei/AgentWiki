### Spec Compliance

- ❌ **Needs fixes**：发现三项会阻断 Task2 要求的实际问题。恢复 composer 后原 selection/section 范围会被 document 覆盖；暂存笔记跨页面组件重建后无法建立发送任务关联；390px 阅读态新增工具栏按钮造成页面横向溢出。详见 R1、R2、R3。
- 审查冻结范围：Base `b5e80d7a725675715b40633ec52356dcc56ed28a` → Head `29366ae445ce3d159acb2a0d6f1a66195fcb0bb1`，唯一变更来源为 `review-b5e80d7a..29366ae4.diff`；已完整读取 53 行 brief（含尾部绑定澄清）、74 行 spec、96 行实施报告和 2324 行 review package。
- ⚠️ 外部 provider、ACP 本机 connector 和部署不由本次 diff 证明；按任务边界分别属于未执行、接口契约、未部署，均不作为本轮遗漏。真实 CUA 属于 controller 提供的回执，本 reviewer 未重新执行浏览器验收。

### Strengths

- 极小 eager registry 与 lazy panel 分离：`agentwiki/apps/client/src/App.tsx:90`、`features/page/PageEditor.tsx:18`；已有最终 build 回执为首屏 JS **548914 / 550000**，没有放宽预算。
- 原始历史来源与本地接受记录分开，跨 mount 仅在身份、权限、版本、标题和预期全文完全一致时重绑 revision：`agentwiki/apps/client/src/features/agent-session/agentSessionCandidate.ts:5`、`:17`、`:22`。源访问失败清候选但保留不含正文的接受 ledger，避免 Undo 后重放：`useAgentSession.ts:59`。
- 当前请求有 user/Space store 与 epoch/lifetime 校验，轮询依据真实 queued/running 状态：`agentwiki/apps/client/src/features/agent-session/useAgentSession.ts:43`、`:50`、`:84`。缺失列表项会直接验证原会话并保留输入：`:74`。
- 阅读选区有 opt-in 原文 span、独立 renderer token、嵌套/生成内容拒绝与 UTF-16 原文偏移校验：`agentwiki/apps/client/src/components/Markdown.tsx:515`、`features/agent-session/readingSelection.ts:3`、`:8`、`:18`。
- 接受仍经过原 PageEditor snapshot/apply 接口；真实编辑器集成测试验证两次接受夹一次人工编辑、三次逐字 Undo 与无 PATCH：`agentwiki/apps/client/src/features/page/PageEditor.tsx:1353`、`:1365`，`PageEditor.spec.tsx:2790`。

### Issues

#### Critical (Must Fix)

- 无。

#### Important (Should Fix)

**R1 · P1：恢复待发送请求时必须恢复其原修改范围，不能自动扩大为全文。**

- 位置：`agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:19`、`:30`、`:33`、`:92`。
- 原因：`targetKind` 仅在 panel 的本地 state 中保存，mount/scope 更新会初始化为 `document`；registry 恢复的 `draft.staged.request.assistTarget` 则仍为原 selection/section。暂存同步 effect 只处理新的 `assistRequest`，相同 request 或新 mount 无 props request 时不会恢复范围。Send 仅在 `requestedTarget.kind === targetKind` 时使用暂存定位，因此直接生成新的整篇 document target。
- 复现：对 selection 范围的失败 proposal 点击 **Regenerate from current draft**，确认范围是 Selection；保留账号/Space registry，卸载并重建 panel（例如切到另一页再返回，或读写路由切换）；直接 Send。原意图和附件仍在，但修改范围变成 Document。
- 小验证结果：真实 `AgentSessionPanel` + registry/useAgentSession、mocked transport，原文为 `one\nkeep\ntwo\n`、原 quote 为 `one`：重建前 scope=`selection`，重建后 scope=`document`，实际发送的 `snapshot.assistTarget.kind=document`、quote=`one\nkeep\ntwo\n`。本次实测 selection；section 使用同一重置与分支逻辑。
- 影响：违反明确的“regenerate 不得静默扩大 selection/section”约束，原来只获准修改局部的请求会按全文范围生成并审阅候选。
- 修复建议：把修改范围及对应定位纳入每会话 composer，或在恢复 staged request 时按其持久上下文恢复范围；原定位失效应要求重新选择，只有明确点击移除附件/改为整篇才扩大范围。
- 修复验收：新增真实 provider/context 集成测试覆盖 selection 与 section 的 regenerate → panel remount、read/edit 切换、会话切换 → Send；payload 保持原范围，定位失效时拒绝 Send 并提供重选，不能发送 document target。

**R2 · P2：跨 mount 恢复的暂存笔记无法建立成功发送后的 task 关联。**

- 位置：`agentwiki/apps/client/src/features/page/usePersonalNotes.ts:83`–`:89`；触发端 `features/agent-session/AgentSessionPanel.tsx:106`。
- 原因：暂存请求存在 session registry，但 `usePersonalNotes.assistRequest` 仅在该 hook 的本地状态中存在；重建时恢复的是 localStorage notes，request 被初始化为 null。成功 Send 虽发出 `dispatch`，hook 的 `!request` guard 会拒绝它。新增历史恢复只接收已经有相同 `note.taskId` 的笔记，无法补上这条从未建立的关联。
- 复现：阅读态创建私人笔记 → **Stage selected for Agent** → 在发送前切换到编辑态，或离开再回到同页 → 使用保留的附件显式 Send。之后 proposal 即使完成并接受覆盖该笔记的 hunk，本地笔记仍显示 Pending，没有 taskId，也不会转 Awaiting review / Resolved。
- 小验证结果：真实 `usePersonalNotes` add → stage → unmount/remount，再按生产回调顺序传入同 user/Space/page/version/IDs 的成功 dispatch、ready、accept，最终为 `{"status":"pending","taskId":null,"localRequest":null}`。这不是其他账号/任务被拒绝的预期行为，事件身份与暂存笔记完全一致。
- 影响：破坏“read/editor 共用待发送对话”中的笔记生命周期；已上传笔记仍被标成未发送，可重复暂存，实际接受候选也无法解决相关笔记。
- 修复建议：恢复 registry 中的待发送请求时，用明确的同 user/Space/page/request/selected note IDs 校验重新建立当前 notes bridge，或让成功发送携带可验证的暂存请求凭据供 hook 绑定。保留私人笔记的显式发送边界及现有异任务拒绝保护，不能直接删除 dispatch guard。
- 修复验收：生产 panel + notes hook 集成覆盖 stage → read/edit 与跨页往返 → Send；Send 前 note 仍 Pending，成功发送后 taskId 正确且为 Dispatched，ready 后 Awaiting review，覆盖 hunk accept 后才 Resolved；错误身份、未被当前暂存请求选择的 note、失败 Send 均不得绑定或解决。

**R3 · P2：390px 阅读态工具栏新增入口后超出视口，页面信息控件不可见。**

- 位置：`agentwiki/apps/client/src/features/page/PagePreview.tsx:617`–`:619`。
- 原因：新增 Agent / 个人笔记按钮仍放在 `flex shrink-0 flex-wrap items-center justify-end gap-2` 的操作容器里；该容器不收缩，缺少可用宽度限制，内部 flex-wrap 没有按移动视口换行。
- 复现：冻结 Head 的阅读页，viewport 390px，打开 Agent。controller 最终 CUA 实测 `documentElement.scrollWidth=489`、`innerWidth=390`；该 toolbar 操作容器 `width=473.06, left=16, right=489.06`，页面信息按钮 `right=489.06`。
- 证据：controller 提供 `/tmp/agentwiki-sessions-20261006/ui-reading-agent-390.png`；本 reviewer 已直接查看，右侧阅读工具栏按钮被视口裁切。已通过的 editor 390px 回执不能替代阅读态验收。
- 影响：违反 390px 文档工具栏可访问与页面不横向溢出的要求；阅读态部分操作落到屏幕外。
- 修复建议：为操作容器允许收缩并约束最大宽度，或在窄屏使用独立全宽换行；保留 Agent、个人笔记、编辑、目录和页面信息的可访问性，并根据换行后的工具栏底部继续定位 sidebar。
- 修复验收：390px 真实阅读页，含长文、宽表、目录与 Agent，确认 `scrollWidth <= innerWidth`，工具栏所有按钮均能操作，Close/Send 可见；再检查 1280/1600 无回归。

#### Minor (Nice to Have)

- 无需阻断的额外建议。

### Checks and Evidence

- 已读取 `/tmp/agentwiki-sessions-20261006/task2/client-final.log`：138 suites / 2051 tests passed；已读取最终 build 日志与实施报告。未重复全套测试、构建或启动服务。既有 lazy chunk >500 kB 提示不是本轮新增问题。
- 已读取 controller 的 `ui-acceptance.md`、`ui-undo-receipt-latest.json`、`runtime-r2/page-checkpoint-post-save.json`、`runtime-r2/ui-regenerate-cancel-receipt.json`：两 hunk/manual/三 Undo/三 Redo、显式 Save 精确落库且 sibling 不变、实际 CLI SIGTERM 均有回执。上述 R1/R2 发生在发送前暂存状态跨 mount，不被这些已通过路径覆盖。
- controller 随后补充最终 390px 阅读态 CUA 实测与截图；其 toolbar 横向溢出单列 R3，不推翻已通过的编辑态移动布局验收。
- 仅为命名风险“恢复的暂存请求能否维持定位及 note task linkage”检查 unchanged helper `agentwiki/apps/client/src/features/page/assistTargets.ts` 的 target API 与 `reviewComments.ts:42` 的状态转换。两项小验证在 Node 内存中转译冻结 diff 的真实组件/hook，使用 React/Testing Library；API、无关候选展示和引用 picker 被隔离，实际 target capture、notes storage/transition 使用项目 helper。没有落盘测试文件，没有修改产品、index、HEAD 或服务。
- 首次合并输出存在工具截断，随后仅补读被截断的 spec 尾部和 diff 范围；未重新生成 git diff，也未另读已完整包含在 diff 中的 changed file。

### Assessment

**Task quality: Needs fixes**

**Reasoning:** 权限、原文映射、候选接受/Undo 与已完成验收主体均有明确证据；但恢复 composer 会改变实际发送范围并丢失 note task linkage，最终 390px 阅读态还存在新增工具栏溢出。三项需修复，并分别用针对性集成测试和真实移动阅读态复验后重审。
