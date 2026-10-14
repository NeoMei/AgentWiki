# Task 2 — 独立审查修复收据

基于 task-2-review.md 固定候选 a7bb3a3f 的 F1/F2 两项 P2；当前共享 root 基线 320906ef。只修改本组生产文件、测试及本收据，未暂存/提交/推送/部署/操作浏览器。使用 receiving-code-review 技能核对实际源码后修复。

## F1：完整 visualViewport 边界

已确认原 horizontal clamp 只使用可视 width，遗漏 offsetLeft。PageEditor 更多菜单现在用 `[offsetLeft+16, offsetLeft+width-16]`；顶边同样用 offsetTop，maxHeight 使用可视height减32。实际菜单高度先限制到maxHeight再选上下展开。订阅打开时捕获的 visualViewport scroll/resize，变化时关闭并沿用窗口事件的焦点回trigger逻辑；清理时解除同一viewport实例监听。菜单自身滚动仍保持打开。

回归：布局视口中visible左边800、宽850、顶边50、高180、trigger.right1620，菜单left>=816、右边<=1634、maxHeight148、top>=66且bottom<=214；仅visualViewport的scroll或resize关闭菜单。该用例先红（原left578），修后通过。

## F2：Portal键盘与blur生命周期

新增 components/portalTabNavigation.ts 小型共享助手：按实际DOM及正tabindex排序找trigger相邻可用控件，排除popup、禁用、hidden/aria-hidden/inert、关闭details和display:none/visibility:hidden；关闭后focus目标时preventScroll。无需浏览器DOM末尾tab顺序，也不循环困住键盘。

AgentContextSettings：popup中的Tab/ShiftTab显式关闭并从trigger相邻控件继续，Escape保持原返回trigger行为。blur.relatedTarget为null或其他外部Node都关闭，保留外点目标的焦点。PageEditor更多菜单：菜单Tab/ShiftTab同样处理；菜单和trigger根节点blur认可彼此，但离开/null关闭。菜单项disabled时焦点仍在trigger，因此trigger所在根节点也处理Tab关闭。菜单Tab stopPropagation，避免portal事件在React树重复处理。

回归：设置正Tab→Send（草稿有文字、可用）、ShiftTab→Message mode；更多菜单正/反Tab→插入在trigger旁的下一/上一按钮；两类null blur关闭不强制回焦点；禁用菜单项时trigger Tab关闭。前7项先红（7fail/186pass），修后193/193；另disabled-trigger测试先红，补齐后全部通过。原Escape、外点、内部滚动、保存模板与上下文发送链路继续通过。

## 最终验证

- 完整本组6文件 `vitest run`：379/379通过、0失败（/tmp/task2-review-final2.log）。比371基础新增8个边界用例。
- `pnpm --filter @agentwiki/client exec tsc --noEmit`：exit0。
- `pnpm exec eslint` PageEditor.tsx、AgentContextSettings.tsx、portalTabNavigation.ts：exit0。
- 全树 `git ... diff --check`：exit0。
- 无浏览器像素或生产通过声明；root此前真实@/取消/同名路径与桌面弹层打开验收未被这些修改改变，但审查新增边界的真实键盘/视觉视口验证可由root继续。

文件：PageEditor.tsx/.spec.tsx、AgentContextSettings.tsx、AgentSessionPanel.spec.tsx、新portalTabNavigation.ts；task-2-report.md 已附审查修复入口。本轮没有改messages.ts、其他组文件或原需求。
