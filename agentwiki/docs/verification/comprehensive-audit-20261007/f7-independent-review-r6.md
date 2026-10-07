# F7 独立修复审查 R6

APPROVE commit 8104a239（仅 NewPageDialog.tsx 与 NewPageDialog.composite.spec.tsx）。本次固定工作区内容与该提交 diff 为零。不是最终任务 gate，不替代新构建 390px 或完整模板实际 UI。

只读审查实际补丁、phase reducer、nextFromSelect/loadPreview、onBlur 刷新、switchMethod、卸载与 configure focus restoration。读取项目 frontend design/workflow/component 规则，没有更改产品或测试，没有 build/runtime/浏览器操作。

- 初次 page preview 进入时设置单次焦点意图，只有 preview 已存在且 loading 结束后聚焦可用的 title/group name；先消费意图再 focus，不依赖挂载时 disabled input 的 autoFocus。
- 等待期间 focusin 取消意图，尊重用户转向 Cancel 等控件。完成一次后普通 preview 内容刷新不重新设意图，受控第二次 deferred request 用例明确验证实际调用两次、Updated name payload、刷新前后 Cancel 保持焦点；不会“根本未刷新也通过”。
- phase 离开时清理 listener/意图。返回 select 在 layout 阶段递增 operation、abort 并清 loading，让下一次选择可以发起独立请求；旧响应同时受 abort/operation 检查，finally 不得清新请求 loading。已有重入用例在旧响应返回后新 input 仍 disabled/unfocused，新响应后才可 focus。作者狭窄 mutation RED 保留。
- configure 既有刷新焦点恢复独立且检查 phase；switchMethod 与卸载继续取消旧请求。页面与对话框焦点语义保留，未修改权限、创建/预览载荷、候选结果页或 E2E 断言。

独立复跑 NewPageDialog.composite.spec.tsx、NewPageDialog.spec.tsx、NewContentPage.spec.tsx：3 files / 42 tests 全通过，0 skip，exit0。日志 /tmp/agentwiki-comprehensive-audit-20261007/f7-independent-r6-tests.log。git diff --check exit0。未发现此限定范围的新可行动问题。

剩余最终验收由 root 合并：完整 client 回归、最终候选 typecheck/build/lint、新构建完整模板十例与必要实际回归、资源清理。此前 R8 九项不能替代十项通过。
