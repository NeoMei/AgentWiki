# Task 2 独立审查 — a7bb3a3f

## 审查对象与边界

- 固定候选：`a7bb3a3f`，输入为 `task-2-brief.md`、`constraints.md`、`task-2-report.md`、`task-2-review.diff`，并逐项阅读原报告 #8–#12。
- 工作目录：`/Users/neomei/.codex/worktrees/bug-retest-release/AgentWiki /agentwiki`。开始时共享 HEAD 已推进至 `320906ef`；用显式 git-dir/work-tree 核对 Task 2 生产文件仍与候选一致，其他组改动不计入本报告。
- 只读源码、差异、现有测试和本地 CodeMirror 6.43.6 实现；未重复已有测试，未操作 UI、生产、Git 写操作或创建子代理。仅运行两个从实际源码提取的边界计算片段，见发现证据。
- 实现报告已记录 CodeGraph 无可用索引，按调度要求没有重试或生成索引。没有采用历史验收作为本轮证据。

## 规格结论：暂不通过

#8、#11、#12 的实现与任务范围一致；#9 的脱离裁切容器及可滚动处理符合意图，但键盘离开行为未完整闭合；#10 仍有可视视口偏移时菜单不可达的问题。下列两项修正前不建议把 #9、#10 记为专项关闭。

| 条目 | 规格核对 |
| --- | --- |
| #8 引用 | 成功选择仅删除记录位置的一个 `@`；取消和显式 ＋ 保留正文；校验全文、账号/Space/页面和会话；结果展示 API 返回的 path。符合。 |
| #9 设置 | body portal、视口/面板交集、换行、限高滚动均存在；Escape 和外点路径正确；焦点离开文档时漏关闭，见 F2。 |
| #10 更多菜单 | portal/z80 解决原层叠上下文遮挡；窄屏及向上展开有实现；visualViewport 横向偏移未处理，见 F1；Tab 后菜单生命周期见 F2。 |
| #11 删除提示 | 10 秒到期仅折叠通知，恢复回执保留；hover/focus/恢复中暂停；新 deletionBatchId 重置组件；恢复错误仍由独立 actionError 显示。符合。 |
| #12 目录 | 保留 AST source offset，不重新按标题文本找位置；CodeMirror 折叠展开逻辑保持；新增实际工具栏底边 margin。当前整页滚动布局下方案有效，像素结果仍需真实 UI 验收。 |

## 质量结论：Request changes（2 项 P2）

### F1 [P2] 更多菜单横向 clamp 必须使用 visualViewport 的完整边界

- 位置：`apps/client/src/features/page/PageEditor.tsx:576–585`（主要修复范围 576–585）。
- 新逻辑将 `visualViewport.width` 当成以 0 开始的页面宽度，没有加入 `visualViewport.offsetLeft`。触发器的 `getBoundingClientRect()` 与 fixed 的 left 使用布局视口坐标；缩放后水平移动可视视口，当前 clamp 会把菜单放回不可见的页面左侧。
- 从实际源码提取定位计算执行，无 UI/mock 测试套件：布局宽 1699，可视视口 `[800,1650]`、width 850，仍可见的 trigger.right=1620；源码得到 `left=578,width=256`，菜单左侧 222px 在可视区外，只剩 34px 可见。这直接违反 #10 的完整可达要求。
- 同一位置处理只订阅 window 的 resize/scroll（611–617），未订阅 visualViewport 的事件；打开后仅可视视口移动也可能保留过时位置。
- 建议：以 `offsetLeft + 16` 与 `offsetLeft + width - 16` 为边界，并对 visualViewport scroll/resize 关闭或重定位。限高也应由当前可视视口高度约束，不能只依赖布局视口的 `100dvh`。增加非零 offsetLeft 和可视视口单独变化的定向断言。

### F2 [P2] portal 后补齐 Tab 离开、关闭与逻辑焦点位置

- 位置：`apps/client/src/features/agent-session/AgentContextSettings.tsx:46–52`；同类缺口在 `apps/client/src/features/page/PageEditor.tsx:1234–1257`。
- 设置 popup 被插到 body 末尾并把焦点送入 select，但只在 blur.relatedTarget 是 Node 且位于外部时关闭。Tab 到浏览器区域或窗口失焦时 relatedTarget 为 null，该分支直接跳过，弹层仍开着。实际 onBlur 源码片段用 relatedTarget=null 执行，`setOpen(false)` 未发生。实现报告所述“Tab 离开关闭”因此不完整。
- 更多菜单 portal 后也没有 Tab 或 blur 关闭处理，仅有 Escape、pointerdown 和 viewport 事件。菜单项获得焦点后，默认 Tab 按 body 末尾的 DOM 顺序离开，不能继续从工具栏触发点附近导航，而且 z80 菜单仍保持显示。Shift+Tab 同样不按触发器邻接顺序返回。
- 建议：两处都显式处理 Tab/Shift+Tab，使关闭后的焦点回到合理的触发器顺序；设置同时处理 null relatedTarget 的离开情况。外点关闭继续保留点击目标焦点，不要无条件抢回触发器。补充 Tab/Shift+Tab 与 relatedTarget=null 的定向覆盖；现有 Escape/外点断言不覆盖这些路径。

## 已核对的关键质量点

- `@` 异步归属：picker 按 user/Space/token 重挂载，搜索使用 AbortController 和当前 token 检查；Panel 选择清理还校验 page scope、session、完整 intent 和字符位置。显式 ＋ 清除快捷触发记录；搜索失败/取消不修改正文。未发现任务内阻塞。
- 文件夹恢复生命周期：计时不清空 restoreInfo，key 为 deletionBatchId；恢复回调继续走既有 batch/OCC/tree revision 参数，成功后清除回执，失败保留回执和独立错误。组件卸载清理计时器。未发现新增阻塞。
- CodeMirror 实际偏移：本地 `@codemirror/view` 6.43.6 的 `DocView.scrollIntoView`（dist/index.js 3420 起）先将 `getScrollMargins().top` 从目标 rect.top 减去，再调用 `scrollRectIntoView`（540 起）。当前 `.document-source-editor .cm-scroller { overflow: visible }`、Layout main 无独立滚动容器，最终 body 滚动会保留该顶部空间；默认 yMargin 还会增加 5px。故不是只写入未被消费的 facet。测试只核对 margin 数值和 source offset，仍不能替代工具栏多行、软折行长标题的实屏结果。
- 现有报告的 371/371、tsc、lint 作为实现方回执记录，本审查未重跑，也没有把它们或本报告解释为真实桌面/390px、原账号或生产通过。
