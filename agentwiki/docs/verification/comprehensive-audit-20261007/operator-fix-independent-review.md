# 文档会话 UI operator 修正独立复审

结论：两项修改合理，可以接受本轮成功 receipt；未发现据此应修改产品的确定性缺陷。只读审查，没有操作 runtime/UI/API，也没有改脚本或产品。审查时新版 ui-1791330073769/receipt.json 已为 passed。

## 修正因果

1. DOM decoration：归档 r1 到 r2 的唯一差异是 readDraft 全选后读 .cm-line，再 ArrowRight 收起。产品 MarkdownWorkspace.tsx:337 起明确把选择覆盖行列为 activeLines，:346 对 activeLines 不隐藏 Markdown 标记；其余行 :353/357 使用 Decoration.replace。因此旧 DOM 缺 ##、代码围栏与产品设计一致，不是正文丢失。全选真实键盘操作使本短文全文标记可见，没有访问 CodeMirror 内部状态或把实际结果倒填 expected。
2. 人工追加：r2 到现版的唯一差异是把 ControlOrMeta+End + insertText(multiline) 改成全选、ArrowRight、Enter、单句 insertText、Enter。manual、firstOnly、firstComplete、expected 以及 expected-final.md 均未改。旧失败只少一个空行；现版以真实 Enter 输入明确行边界，最终 exact-byte 比较通过。现有证据不足以区分旧问题属于 End 光标定位还是合成多行 input 路径，因此不能据此宣称产品粘贴正常，也不能把它认定为已复现产品 bug。当前操作满足人工键盘追加的验收目标。

## 实际覆盖

- 两处选文笔记由真实控件建立并勾选，显式参考由搜索/添加控件加入；POST response 确认 2 annotations、reference ID、首轮原始 snapshot。
- 第一候选生成后人工追加；逐项接受后分别比对 firstOnly 和 firstComplete；每次确认正式三页正文/title/updatedAt 未变。
- 真正编辑器 Undo 撤销最后一项到 firstOnly，Redo 回 firstComplete；人工追加保持。
- 第二候选发送 snapshot 必须包含人工+前轮接受的完整草稿；接受后 exact expected，正式页仍未变。
- 点击 Save 并等 PATCH 成功，独立 HTTP 精确比对预先构造 expected；仅主页版本推进，另两页原文及版本不变。
- 在兄弟页选回同会话并展开第一轮原始 Markdown，精确等于 original；reload 后第二轮仍存在，正式内容仍正确。

## 不应扩大宣称的边界

- 本轮两候选顺序执行，不验证并行返回的候选竞争、跨用户并发或冲突拒绝。
- 只验证非冲突的人工追加与两处 replacement rebase；不验证改动命中人工编辑范围后的冲突处理。
- readDraft 全选会改变选区，且 DOM 全文读取仅适用于当前短 fixture，不能推广为任意长文虚拟化完整性检查；操作结束会收起，不写正文。
- 2 annotations 与 reference ID 到达 API 已断言；精确 quote/offset、参考正文真正传入 provider 应以 fixture-process-events/history checkpoint 补证。本脚本本身没有逐字断言 annotations 内容，也没有证明模型语义使用引用。
- 第二历史 turn reload 后仅断言存在；第一 turn snapshot 已逐字验证，不能宣称所有历史字段/第二快照显示均核验。
- Undo/Redo 之后至第二候选接受后才再次 readback，因此没有单独证明 Undo 瞬间绝无短暂后端写入。已覆盖的各接受点和最终 Save 边界均有正式页不变断言。
- 本轮 deterministic external provider，不是真实模型质量/真实供应商集成验收。

证据：run-document-ui-dom-decoration-r1.mjs、run-document-ui-multiline-input-r2.mjs、run-document-ui.mjs；ui-1791329952577 与 ui-1791330024573 原失败 receipt/actual-draft；ui-1791330073769 成功 receipt；baseline.md、expected-final.md、fixture-protocol.mjs、document-checkpoints.mjs。

## 成功 trace network 补证

只读解析 ui-1791330073769/trace.zip 的 trace.network：全程只有两笔 /assist/... POST，均为该成功 session 的 /turns。第一笔 2026-10-06T23:41:16.138Z，第二笔 23:41:18.804Z。两笔笔记截图记录 23:41:15.614Z，staged+reference 截图记录 23:41:16.093Z。trace.trace 的第一 assist-submit click startTime=2541.369，结合 context wallTime=1791330074038、monotonicTime=471.813，约为 23:41:16.108Z。由此确认两笔本地笔记及 staged/reference 阶段没有 assist POST，第一 turn POST 在真实 Send 点击之后；不是仅以截图推断。
