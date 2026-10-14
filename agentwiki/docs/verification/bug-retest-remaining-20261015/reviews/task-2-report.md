# Task 2 — 页面编辑、引用与弹层（#8–#12）

状态：本地实现候选已完成；定向客户端 6 文件 371/371 通过，客户端 tsc 与本组 ESLint 通过。没有进行浏览器操作、生产读写、暂存、提交、推送或部署；真实桌面/窄屏 UI 验收由 root 串行执行。

## 来源与定位方式

- 原需求逐项阅读 `agentwiki/docs/verification/bug-retest-remaining-20261015/report.md` #8–#12，按 Task 2 brief 与 constraints 实施。
- 在工作树根和 agentwiki app 各执行一次 `codegraph explore`，均明确返回没有 `.codegraph/` 索引。与 constraints 的“有索引”记录不一致；按 AGENTS 指令跳过，没有创建索引。随后按数据流使用 rg 与源码定位。
- 使用 systematic-debugging、test-driven-development、verification-before-completion 的根因→红灯→修复→实证验证流程。历史记忆只用来确认尾空格路径及发布/验收分开报告的约束，未把旧版本验收当成本轮验收。

## #8 — @ 引用反馈与 + 入口

根因：AgentSessionPanel 输入 @ 时只增加 openRequest；AgentReferencePicker 选中仅更新 references，未提供“已选中”事件。调用方无法区别选择成功、取消和移除引用，正文自然保留孤立 @。搜索 API 已返回 canonical `page.path`，选择器映射时却丢弃路径，导致同名文档无法区分。

修复：Picker 新增 onSelected 与显式按钮 onOpen；Panel 记录触发 @ 的原始全文、字符位置、账号/Space/页面及会话。只有成功选择且当前全文和身份仍匹配时，移除该位置一个 @；取消保留用户输入，显式 + 清空快捷触发记录，不移除正文中的字面 @。引用数已到5时不再记录快捷触发。选中返回输入焦点并把光标放回触发位置。显示中英双语说明“@ 或 ＋ 添加文档上下文；选择后仅移除触发用的 @”。结果保留并展示 canonical path。

验证：原“Compare with @ 选择后仍留 @”断言改为预期清理后先红；同名搜索路径先红；当前选择后清理、取消保留、随后 + 保留字面 @、中间插入仅移除触发字符、邮箱与中文 IME 不误触、5篇上限、账号/Space 隔离及搜索取消等全部通过。没有发送 Agent 请求验证此界面交互。

文件：AgentSessionPanel.tsx/.spec.tsx、AgentReferencePicker.tsx/.spec.tsx、agentSessionTypes.ts、i18n/bug-editor-messages.ts、index.css。

## #9 — 上下文设置裁切

根因：旧 `.agent-settings-popover` 绝对定位 `right:-40px`，留在 `.agent-session-panel` 与宿主的 overflow:hidden/auto 裁切链内，z-index 再高也无法逃逸。

修复：AgentContextSettings 将内容 portal 到 document.body；复用已验证的 referencePopoverPlacement，根据 panel 和 visualViewport 的交集选上下方向、限宽限高；fixed/z80、正文换行、内部滚动。ResizeObserver、窗口滚动/resize 及 visualViewport 更新位置，内部滚动不误重定位。内容关闭时卸载；Escape 回 summary、外点不抢焦点；打开后首个可操作字段获焦，Tab 离开关闭，隐藏面板关闭。

验证：Portal 父节点断言先红；打开后键盘焦点断言先红，修复后通过。已有设置范围、候选/直接修改说明、Escape/外点及 PageEditor 真实选区/章节发送链路全部回归通过。placement 的已有390px/面板交集/上下空间测试继续通过。没有声称 jsdom 能提供真实像素截图。

文件：新增 AgentContextSettings.tsx；AgentSessionPanel.tsx/.spec.tsx、PageEditor.spec.tsx、index.css。

## #10 — 更多页面菜单遮挡

根因：旧菜单 fixed/z20，但仍在 sticky/z20 工具栏层叠上下文中；侧面板是另一个 fixed/z30 上下文。原实现已有水平390px clamp，不需重写，但未摆脱工具栏上下文，也未处理下方空间不足。

修复：菜单 portal 到 body 并 z80；沿用水平 clamp，按实际菜单高度及视觉视口下边界选择上方/下方；限高并允许自身滚动。外点监听同时认可 trigger/menu DOM；修正 window 捕获 scroll 导致菜单内部滚动时被关闭，保留页面滚动/resize 关闭及 Escape 焦点恢复。

验证：两处390px菜单脱离工具栏断言先红；菜单内部滚动保持打开先红。最终左右边缘、触发位于视口底部、菜单滚动、键盘入口/Escape/外点、点击保存模板、未保存禁用原因、能力和路由身份等全部通过。

文件：PageEditor.tsx/.spec.tsx。

## #11 — 文件夹删除提示永久停留

根因：SpaceView `restoreInfo` 既是恢复回执又直接决定顶部成功 banner 的存在，没有独立的通知展示生命周期；清掉它会丢失恢复所需 deletionBatchId/OCC 字段。

修复：独立 FolderDeletionNotice，把成功通知和恢复回执展示拆开：10秒后移除顶部成功状态条，保留左下方小恢复入口（完整文件夹名保留在 title）。hover、内部焦点及恢复请求期间暂停计时，结束后给予完整10秒。可先关闭顶部提示，再显式关闭恢复入口；新 deletionBatchId 重置生命周期。恢复仍调用既有 restoreFolder 的批次/版本/树版本校验。SpaceView actionError 仍独立持久显示，不参与成功通知定时器；没有修改通用 Toast 的错误策略。

验证：SpaceView 两种父目录保留/消失场景的“10秒计时/成功banner消失/恢复button仍可用”先红（无计时回调）；修复后绿。新组件4项验证9999/10000ms、恢复回调、focus/hover/恢复中暂停、禁用、下一批删除重新显示、两步显式关闭。长名字可断行，窄屏最大宽度限制。仍需实际删除-等待-恢复的真实 UI 验收。

文件：新增 content-tree/FolderDeletionNotice.tsx/.spec.tsx；SpaceView.tsx/.spec.tsx；i18n/bug-editor-messages.ts。

## #12 — 编辑目录标题定位

根因：目录已按实际 Markdown AST source offset 定位，重复标题与 fenced code 的映射正确。跳转使用 EditorView.scrollIntoView(y:start)，缺少编辑页 sticky 工具栏实际底边的 scrollMargins；CodeMirror 的文档/祖先滚动不能获知覆盖在内容上方的工具栏。多行工具栏使固定常数更不可靠。

修复：只增加动态 EditorView.scrollMargins，每次滚动计算当前 editor-toolbar.getBoundingClientRect().bottom + 12px。保持已有 AST 位置、默认展开折叠范围、live-preview 测量机制及各级标题导航，不引入按文本重新查找或估算行号。

验证：新增工具栏底边142px→顶部预留154px断言先红；现有重复标题选择第二项source offset21、排除代码块标题依然通过。新增折叠父章节内Child标题，选中实际offset14且 foldedRanges 从1→0，当前版本直接通过，证明已有 CodeMirror 默认展开行为，不重复修复。完整 MarkdownWorkspace126项、PageEditor141项均通过。真实主页面/多行工具栏/超长软折行标题的像素验收留给 root。

文件：MarkdownWorkspace.tsx/.spec.tsx。

## 最终验证与门禁边界

1. `pnpm --filter @agentwiki/client exec vitest run src/features/space/SpaceView.spec.tsx src/features/content-tree/FolderDeletionNotice.spec.tsx src/features/agent-session/AgentSessionPanel.spec.tsx src/features/agent-session/AgentReferencePicker.spec.tsx src/features/page/PageEditor.spec.tsx src/components/MarkdownWorkspace.spec.tsx --reporter=dot`：6文件371通过、0失败（最后完整回执 `/tmp/task2-confirmed-tests.log`）。
2. `pnpm --filter @agentwiki/client exec tsc --noEmit`：exit0；修正 SpaceView.spec.tsx 的浏览器number/Node Timeout mock返回类型后通过。
3. `pnpm exec eslint` 对本组9个生产TS/TSX文件：exit0；AgentContextSettings 最新焦点变更后该文件定向lint再次exit0。
4. 未运行本组独立生产 build；由 root 集成门禁执行。原报告真实账号/原页面、桌面1699×935和实际390px截图仍需 root 验收，不以单元总数代替 UI 或生产通过。

## 文案整合

共享 messages.ts 未由本代理修改。新增 `agentwiki/apps/client/src/i18n/bug-editor-messages.ts`：
- editor.referenceHint（中英完整说明）
- folder.restoreRecent（中英恢复入口）
组件当前直接引用此模块；root 可按整体 i18n 结构整合或保留模块。

## 本组完整文件清单

生产：
- apps/client/src/features/agent-session/AgentContextSettings.tsx（新）
- apps/client/src/features/agent-session/AgentReferencePicker.tsx
- apps/client/src/features/agent-session/AgentSessionPanel.tsx
- apps/client/src/features/agent-session/agentSessionTypes.ts
- apps/client/src/features/page/PageEditor.tsx
- apps/client/src/components/MarkdownWorkspace.tsx
- apps/client/src/features/content-tree/FolderDeletionNotice.tsx（新）
- apps/client/src/features/space/SpaceView.tsx
- apps/client/src/i18n/bug-editor-messages.ts（新）
- apps/client/src/index.css（仅设置popover及引用hint样式）

测试：AgentReferencePicker.spec.tsx、AgentSessionPanel.spec.tsx、PageEditor.spec.tsx、MarkdownWorkspace.spec.tsx、SpaceView.spec.tsx、FolderDeletionNotice.spec.tsx（新）。

## 独立审查后的修复

F1视觉视口完整边界、F2Portal Tab/blur已修；最新本组6文件379/379、tsc/定向lint/diff --check通过。完整红绿证据见同目录 task-2-review-fix-receipt.md；该收据更新此前371基础回执，不代表生产/真实像素通过。

## 全量门禁发现：AgentSessionNotes helper兼容（2026-10-15）

原全量客户端155文件中AgentSessionNotes.spec.tsx的5项笔记/会话流程失败。定向先复现5fail/23pass（/tmp/task2-notes-helper-red.log）。根因是测试helper第43行先getByRole(Edit scope, hidden:true)，假设关闭的details中仍存在select；当前产品有意在Context settings打开后才挂载body portal，关闭时卸载，此时隐藏查询同样找不到未挂载节点。产品范围选择功能没有丢失，已通过真实打开+修改范围链路再次验证。

仅修改AgentSessionNotes.spec.tsx editScope helper：dialog不存在时点击Context settings summary；确认dialog可见，在dialog内查询可见Edit scope combobox并继续原toBeVisible/value/change断言。没有hidden:true绕过、没有跳过/删减五个业务流程断言，没有改生产或构建dist。

验证：
- 单文件28/28通过（/tmp/task2-notes-helper-green.log）：包括本地staged request会话隔离、selection/document remount conflict再生成、mixed document部分接受+Undo两种覆盖。
- 全agent-session目录5文件113/113通过（/tmp/task2-agent-session-all.log），0失败；覆盖Notes、Panel、ReferencePicker、candidate及readingSelection。
- 定向eslint AgentSessionNotes.spec.tsx exit0；客户端tsc --noEmit exit0。
- 本收据是测试交互helper兼容修复，不将root此前全量失败重写为全量通过；需root重跑受影响客户端/整体门禁后记录实际新回执。无提交、UI或生产操作。
