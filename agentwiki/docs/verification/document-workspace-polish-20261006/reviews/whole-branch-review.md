# 文档工作区第二轮整分支独立审查

日期：2026-10-06。只读审查，仅写本报告；不修改产品、Git 状态或配置，不派生代理，不重复运行已通过的全套检查。

- 冻结 HEAD：`dcfccd3e5f9f7883e73a2852f6e8adb7915a5e8f`；审查开始时工作树干净。
- 本轮深入审查范围：`28e07dbd14dfe49ecfbb3ce503debf073d573241..dcfccd3e`，6 commits，14 files，500 insertions / 34 deletions。三个产品组件、对应行为测试、PageEditor 集成测试和计划/交接资料。
- 整分支集成上下文：`c7b89567..dcfccd3e` 完整审查包，结合第一轮 `897aa3f8` 的独立 whole-branch review / acceptance。本轮逐项检查全部新增产品变更，并对共享 diff 消费端、候选接受和笔记作用域/派发做命名风险的源码核对；没有把第一轮报告宣称为本 reviewer 新做的全仓测试或再次逐行重审。
- 依据：本轮 plan、constraints、progress、两项任务 brief/report/review，以及原分支验收与最终审查。初次工具输出发生截断后，补读相关变更及源码，未把截断结果视作完整阅读。

## Strengths / integrated checks

1. **差异折叠不改变内容或差异算法。** `MarkdownDiff.tsx:13-30,38-59` 仅对既有 bounded diff 建立未改动区间视图，变更相邻各三行保留，区间展开与完整预览均可到达省略行。输入变化立即按新 diff 身份重置展示状态，模式切换不修改源文本。新增/删除统计取自实际预览行；截断时明确标成 Preview/预览，零可见变更明确限于显示范围。源码仍作为 React 文本输出，不作为 HTML 执行。共享的提案审阅消费端仍使用默认警告，未增加接受或审批路径。

2. **候选优先展示可审阅操作，应用门保持原样。** `AssistCandidateReview.tsx:12-14,24-62` 从计划中真实 edit ID 计算进度；独立变更有编号，原文对比以 disclosure 提供，单项不可分割与不支持 scoped apply 的情况仍有主 diff。下载按钮、显式接受/丢弃以及截断警告留在 disclosure 外。每项与整项按钮沿用权限、ready 状态和 accepted-ID 条件，未用视觉状态代替身份/版本检查。

3. **跨组件接受安全没有被新布局绕过。** 核对 `AgentAssistPanel.tsx:334-352` 和 `PageEditor.tsx:825-845`：读取当前候选、实时 snapshot 和 accepted ledger，父级再次检查身份、Space/page、权限、保存/编辑模式、远端 revision/conflict 与当前 EditorView 源文，再以既有隔离交易应用。`assistCandidate.ts` 和 `assistTargets.ts` 的 exact/unique anchor、范围字节保护、重算计划和重复接受拒绝未变化；新子组件只转发显式 callback。流式生成仍不写正文，接受仍不等于 Save。

4. **笔记选择从可见、可派发集合导出。** `PersonalNotesPanel.tsx:16-35,49-67` 的 Open 包含 pending/dispatched/awaiting-review；选择资格只含可见 pending 且当前锚点唯一有效的笔记。派发、计数和 checkbox 同步读取这个集合；effect 再永久删除失效 id，避免重新打开或恢复原文后复活旧选择。切换筛选显式清空选择，全选/清除只改变 UI 状态。`notesForDispatch` 仍作最终完整性和锚点校验。权限禁用保持在写操作上，筛选本身可读可用。

5. **私人作用域及状态机仍由既有控制器持有。** 核对 `PageEditor.tsx:601-639,1262-1285`、`usePersonalNotes.ts:25-104` 和 `reviewComments.ts`：面板以 identityKey 区分 user/Space/page，身份变化清状态；父级 hook 在派发前再次使用 live source/version 校验，请求限额和仅显式提交路径未放宽。自动发送仍以请求 ID 防重；note dispatch/ready/accept 绑定 task 与 candidate 作用域，保守 coverage/uncertain 逻辑未变化。新过滤视图未自行标记笔记已解决，也没有把隐藏笔记发给 Agent。

6. **测试验证行为而非样式实现。** 新覆盖包括长前缀折叠和可逆展开、输入重置、部分预览的诚实文案、中英文、下载完整原文、接受进度与禁用；笔记覆盖 A 派发后 B 单独派发、删除/失效/已解决后的选择清理、筛选隔离、全选资格、无自动派发和未完成编辑保留。PageEditor 测试只增加实际 All 筛选操作以观察 resolved 状态，逐项正文、只接受一次、分别撤销及不保存断言仍保留。

## Consolidated findings

### Critical — Must fix

无。

### Important — Should fix

无有证据支持的阻塞项。

### Minor — P3，建议本轮一并修复

**筛选计数被 aria-label 从可访问名称中隐藏。**

- 位置：`agentwiki/apps/client/src/features/page/PersonalNotesPanel.tsx:50`。
- 复现/证据：按钮显示 `All (4)` / `Open (3)` / `Resolved (1)`，但 `aria-label={label}` 将可访问名称覆盖为 `All` / `Open` / `Resolved`。屏幕阅读器在这些筛选按钮上无法读到队列数量；这正是本轮新增的有意义状态信息。中文有同样问题。
- 修复：移除冗余的 aria-label，让可见文本直接提供名称；或让 label 同样包含 count。相应修改 `PersonalNotesPanel.spec.tsx` 和 `PageEditor.spec.tsx` 的精确名称 locator，保留队列计数、过滤、接受/撤销断言。增加/调整中英文的 accessible-name 断言即可，无需扩展实现或引入新组件。
- 分级：过滤和键盘操作仍正常，不影响正文、权限、派发对象或数据，因此为 Minor。与 Task 2 独立审查相同，合并为一个 finding，不重复计数。

## Validation / boundaries

- 本 reviewer 额外执行新产品范围 `git diff --check 28e07dbd..dcfccd3e -- agentwiki/apps/client/src`：通过，无诊断；没有改写保真 fixture 或 Git 配置。
- 读取 task reports / progress 与 controller 提供的最终检查结果：Task 1 77 focused tests、Task 2 154 focused tests、完整 client 1865 passed；repo typecheck/build 通过，lint 0 errors / 3 处既有服务端 warning，首屏预算 `547266/550000` 不变。这些为对应生产者的验证记录，本 reviewer 未重复运行完整套件，也未将它们宣称为独立浏览器证据。
- Controller 已报告 Task 1 真实浏览器验收和笔记 add/filter/select 在 desktop/390px 通过；笔记发送遇到 `ERR_CONNECTION_REFUSED`，且已确认隔离 runtime 自有 PID 退出。该事实目前支持环境中断，不支持产品缺陷；runtime 恢复后仍须完成 send/reopen/候选衔接验收及清理回执。
- 原生 IME、Windows、真实外部模型 provider 和多人压力范围沿用第一轮限制。本轮不声称新增这些验收，也不授权合并、推送或部署。
- 当前计划和 checkpoint 是过程资料，controller 应在收尾时更新最终状态；这些后续文档尚不在本冻结 SHA 内。

## Account route evidence

本 reviewer thread 为 `01a10fe8-a435-76c3-94d1-08e98a082f49`。实际 session log `/Users/neomei/.codex/sessions/2026/10/06/rollout-2026-10-06T14-31-07-01a10fe8-a435-76c3-94d1-08e98a082f49.jsonl` 的最新 `turn_context` 时间 `2026-10-06T06:31:11.381Z` 记录 `model=p5c07ff/gpt-6-astra`、`effort=ultra`。仅查看这些模型元数据，没有访问凭据；没有裸模型/main 回退或另行派发。

## Assessment

**Ready to merge? Yes — code review approved with one minor accessibility finding.**

本轮实现符合已批准边界，未发现正文、权限、版本、私人作用域、选择资格或状态迁移的新增重要回归。建议用一次小修复解决计数的可访问名称并作定向复审。代码审查通过不代表发送流程的浏览器 gate 已关闭；该 gate 由 controller 在恢复隔离环境后完成并单列记录。
