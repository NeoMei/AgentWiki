# Agent Sessions — scoped final re-review

- Reviewer: `sessions_final_review`，独立复审，未派子代理。
- 冻结范围：`5d6c6bad6b6580490326f63d680d60e0b223db89` → **`3cc1d78cc58a188e72b6fcb59916f0bed0ed62c9`**。
- 完整读完 `final-fix-report.md` 与本轮 678 行 diff；package SHA256：`b0426d2f09899839fe15235bcbc2ee025378dac1e7624041f1837192d7adeb04`。
- 范围仅为原 `final-review.md` 的 F1/F2 闭合及此次修复的直接影响；承接原整体审查，不重新泛审后端、迁移或周边功能。
- **结果：F1 CLOSED；F2 OPEN（选区路径已修复，整篇文档再生成仍遗漏）；全功能最终 gate 尚未通过。**

## Strengths

- 成功 Send 的事实现归属原 user+Space registry，包含发送前复制的请求、page、session、原始全文/标题/保存版本及选中的批注；POST 和历史交付都校验同一证明。旧 mount 不再直接调用旧页面 notes 回调。
- `useAgentSession.ts:53–60,87–94,155–167` 的授权读栅栏有针对性：离开原 bridge 的迟到回执必须经由回执存在之后才启动的历史读取确认，旧 queued history 请求不能提前认证迟到成功。当前 epoch、abort、session、Space 校验仍在，access failure 清除回执和候选。
- composer 消费按原会话/原对象和 staged 对象区分；原请求回执不会覆盖后来输入、另一会话或新 stage 的批注。notes hook 在 session 模式使用原回执证明，`onRequestHandled` 仍按 request ID 消费，因此不同新请求能够保留。
- 显式 supersedes 证明限制在正确旧 task、身份、来源版本及原批注范围；失败 Send 不提前 reopen，Resolved 不被自动重开。旧 task 的 ready/accept/fail/discard 经 note.taskId 栅栏不能改变已绑定新 task 的笔记。

## Finding closure

| 原 finding | 状态 | 判断 |
| --- | --- | --- |
| F1：在途 Send 跨路由丢失关联/composer 消费 | **CLOSED** | registry receipt、安全交付及原 composer 消费完整覆盖原缺陷；生产组件回归包含 read/edit、回执到达前后离页返回、失败重试、错误 canonical source/annotations、账号/Space 切换、新消息/新请求隔离及 fresh-read 403 竞争。 |
| F2：Regenerate 后未解决笔记仍绑定旧 task | **OPEN，部分修复** | 原 selection 重建冲突路径已有有效 supersession 与覆盖接受回归；但原 turn 使用 Document 范围时，Regenerate 生成的 receipt 缺少 hook 强制要求的 assistTarget，同一笔记关联缺陷仍发生。详见下文。 |

F1 的 CLOSED 是代码与现有自动化回执的独立复审结论；根协调器并行进行的真实浏览器验收不冒充本 reviewer 的重跑结果。

## Issues

### Critical (Must Fix)

无新增 Critical 问题。

### Important (Should Fix)

### F2 · P2 · OPEN — 整篇文档的 Regenerate 回执缺失 target，接受成功后笔记仍绑定旧轮次

**位置：** `agentwiki/apps/client/src/features/agent-session/AgentSessionPanel.tsx:139–144`；实际拒绝点 `agentwiki/apps/client/src/features/page/usePersonalNotes.ts:94–97`。当前 Send 在 `AgentSessionPanel.tsx:112–124` 正确生成新的 document snapshot target，但该 target 未进入 `credential.request.assistTarget`。

**触发：** 使用现有公开 UI：stage 一条批注，选择 proposal，并把 Edit scope 切为 Document 后 Send。turn-1 完成，笔记 Awaiting review。选区外追加人工尾段并 remount，原候选显示 Conflict；点击 Regenerate from current draft → Send → 接受新候选。该流程不需要非法事件、错误来源或并发异常。

**原因：** 再生成对 `document` 有意使用当前全文，所以 `scopedTarget` 为 undefined，新的 staged request 也没有 assistTarget。Send 虽为实际 POST 的 snapshot 重新捕获完整 document target，却在此前直接复制了 staged request 作为回执。成功交付时 notes hook 的 `!request.assistTarget` 判断直接返回，尚未到达本次新增的 supersedes 转移逻辑。Panel 随后删除回执；新候选 ready/accept 又因笔记仍绑定 turn-1 无法更新该笔记。

**独立 focused 验证：** 冻结工作树的真实 `AgentSessionPanel`、registry、`useAgentSession`、`usePersonalNotes`、note/target helper 和 `applyCandidateToDraft` 在 Node 内存中转译，并由 React Testing Library/JSDOM 执行；仅替换 HTTP、认证/语言和不相关展示组件。两次合法 canonical POST 均返回 done 提案。通过 UI 的 Edit scope/Regenerate/Send 及真实应用回调观察到：

```json
{
  "case": "notes document scope -> remount conflict -> Regenerate -> Send -> Accept",
  "before": [
    { "status": "awaiting-review", "taskId": "turn-1" },
    { "status": "pending" }
  ],
  "afterSend": [
    { "status": "awaiting-review", "taskId": "turn-1" },
    { "status": "pending" }
  ],
  "afterAccept": [
    { "status": "awaiting-review", "taskId": "turn-1" },
    { "status": "pending" }
  ],
  "postCount": 2,
  "patchCount": 0,
  "content": "ONE\nkeep\ntwo\nManual end\n"
}
```

两轮 snapshot.assistTarget.kind 均为 `document`，noteIds 均仅包含原选中笔记。上面省略了随机 UUID，其他状态、taskId、计数和正文为实际输出。正文接受成功且人工尾段保留，但选中笔记没有迁移或解决；未选中私人笔记仍 Pending。

**影响：** F2 的生命周期问题仍存在于支持的整篇文档范围中，用户执行成功的再次上传和覆盖接受后仍看到旧 Awaiting review。它是原 F2 的遗漏分支，不是另立功能或要求扩大原范围。

**修复建议：** 让 document 再生成的发送回执也包含与此次发送快照一致、能够验证的 target 证明；在实际 Send 时捕获当前 document target，而不是保留旧全文 target，也不要简单删掉 notes hook 的原文/版本保护。保留 supersedes 的身份、旧 task、原批注、未解决状态和旧事件栅栏。

**闭合验证：** 将现有 F2 生产组件用例补为 selection 与 document 两种范围。Document 需经产品现有下拉框选择，完成上述完整序列后要求新 Send 绑定 turn-2，真实 quote 覆盖接受后仅该笔记 Resolved，人工尾段保留、未选笔记仍 Pending、无自动 PATCH。保持失败 Send、Resolved 及旧 task 事件负例，不必重做后端或迁移审查。

### Minor (Nice to Have)

无新增需要单列的 Minor 问题；没有将既有 chunk 提示或阶段外 provider/ACP 能力列为缺陷。

## Plan alignment and checks

- 修复架构与原计划一致：沿用现有会话 registry、明确 Send 才上传、原始 source proof、私人笔记 task 绑定和实际接受覆盖。未新增传输服务、依赖、数据库迁移或自动 Save。
- 原整体审查对后端、迁移、权限、候选写入和先前 R1–R4 闭合的判断不变；本轮只留下上面的 F2 Document 分支。
- 已读取最终 `final-fix/client-full.log`：**139 suites / 2091 tests 全通过**；`authorization-green.log`：**3 suites / 70 tests 通过**。这些是 implementer 回执，本 reviewer 未重跑套件。
- 已读取最终 build log：`index-DEi1o3Ly.js`，构建 4.74s 成功；报告记录初始 JS **548914 / 550000 bytes**，未放宽预算。typecheck/scoped lint 的 exit 0 由 `final-fix-report.md` 提供。
- 本 reviewer 新执行仅上述一个具体疑虑的 focused 组件 probe；第一次脚本把 add 与读取 hook 返回值放进同一 act，读到旧渲染快照而退出，拆开 act 后完整复现。没有新增测试文件、运行服务、数据库操作、读取 runtime 凭据或调用 provider。
- HEAD 在核对结束仍为冻结 `3cc1d78c…`；产品、index、HEAD 未修改，仍仅根协调器四份 `.codex-memory` 文件 dirty。本次只新增此复审报告。
- 既有真实 API/worker/CLI fixture 及整体 UI 验收继承原回执的边界；真实 provider 未加载、ACP 仅契约、无部署。本轮根协调器的 F1/F2 实际浏览器结果由其单独记录。

## Recommendations

只补齐 F2 Document 的发送证明与生产组件回归，然后对该小差异及对应实际 UI 路径复核。当前 selection 路径的成功与全量 2091 tests 不能代替遗漏的 Document 分支，也不应为此重启全仓审查。

## Assessment

**Ready to merge? No — F1 CLOSED, F2 remains OPEN.**

F1 的持久回执、授权重新读取和 composer 隔离已闭合；F2 的 selection 修复可靠，但 Document 再生成仍可出现成功接受正文而笔记永久绑定旧 task。该 P2 分支修复并独立复核前，全功能最终 gate 不能关闭。
