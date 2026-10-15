# Agent chat feedback 最终独立审查

- 审查范围：`479419eff227a09350dd7cdc695450de238bb894..b2620dc7fb9aa9f2cf14091bcc182841641a1ca7`，22 个文件。
- 工作树：`/Users/neomei/.codex/worktrees/agent-chat-feedback/AgentWiki `（末尾空格）。已实读 HEAD 与完整最终差异，生产源码无未提交差异；已有未跟踪任务记录不属于本次代码审查。
- 输入：`brief.md`、`server-report.md`、`client-report.md`、`server-review.md`、`integrated-diff.patch`、`fix-diff.patch`；并追踪最终文件、受影响调用链及现有验证日志。
- 本轮只读源码，没有改代码、重跑测试、调用真实模型或生产服务。仅新增此审查报告。

## 结论

- **Spec compliance：PASS。** 执行期间独立阶段反馈、耗时、重试、Stop，以及嵌入聊天专用的紧凑候选审阅均符合 brief；草稿接受、显式 Save、阅读态显式 direct、授权和版本 CAS 边界保留。
- **Code quality：APPROVE。** 三项已知问题均已修复；最终分支没有发现新增阻塞项。
- **已知 finding：3 addressed / 0 unaddressed；新增阻塞：0。** 此结论是本地候选审查，不代表真实 provider 或生产发布验收。

## 三项修复确认

| Finding | 结论 | 最终代码与验证依据 |
| --- | --- | --- |
| 重新 claim 后旧 `result.progress` 被当成新运行阶段展示 | **Addressed** | `assist.queue.ts:146–152` 在同一次 queued → running `updateMany` 中仅对 session 设置 `result: Prisma.DbNull`，没有先暴露 running 再异步清理的窗口。新的 `preparing` 仍在当前授权通过后写入。新增回归实际串起 recovery → backoff → claim → session `get()`，暂停于 runtime 启动前，验证没有旧 `finalizing/2`，再验证新 `waiting/1`；非 session claim 明确保留旧 result 语义。 |
| 自动滚动事件晚到，错误退出 follow，下一轮进度被 composer 裁切 | **Addressed** | `AgentSessionPanel.tsx:38–65, 331–339` 在程序写 `scrollTop` 后同步记录实际位置；相同位置的迟到事件及单纯高度增长不再取消 follow，真实向上移动退出，接近底部的向下移动恢复，底部收缩钳位保留状态。回归覆盖连续 93px/后续增长、迟到事件及底部附近向上 20px；红绿日志与修复后桌面/390px 截图相互吻合。 |
| compact 单项唯一 Accept 退化为整篇接受，拒绝无关手工修改 | **Addressed** | `AssistCandidateReview.tsx:57–61` 仅当 compact + supportsScopedApply + 唯一 edit 时传该 editId；原非 compact、无 scoped 支持、多项主操作保持原调用。`AgentSessionPanel.accept` 与 `PageEditor.applyAgentChanges` 两次使用同一 editId 经 `applyCandidateToDraft` → `acceptCandidateEdit`，保留身份/权限/版本/唯一上下文锚点校验。新增真实 PageEditor 集成覆盖距修改处 700 字符的手改、两次独立 Undo、无页面 PATCH、Undo 后不可重放。 |

## 整体调用链复核

- **公开进度 DTO**：`sanitizeAgentProgress` 只重建四个固定 phase 和 1..100 整数 attempt。queue 入库及 session service 出库独立过滤；只有 running 返回可选 progress，queued 使用状态回退，终态不返回 progress。临时 result 不进入 `publicResult` 或历史上下文。
- **真实阶段来源**：queue 在授权后发 preparing；router 在目录准备与每个实际模型尝试前报告 preparing 并标注 attempt；runner 从进程启动、已识别的 step_start/text、成功 close 产生 waiting/generating/finalizing。phase 不携带 provider/model/raw payload；session 不订阅旧 raw-stream 回调，既有完整答案验证未改变。
- **取消、失败、lease 与授权**：阶段与答案共用串行写入链，每次写入重查 session 授权并匹配 running、worker、有效 lease；授权等待后再查 abort。失败先 abort 并排空链，再写失败终态和空 result/text；取消及 lease 接管使旧写入条件不成立；成功以最终 summary/changes 替换临时 result。
- **UI 生命周期**：sending 立即显示，queued/running 在答案为空或旧服务器缺少 progress 时仍有反馈。活动组件随终态卸载并清理 interval，phase 切换不重置 elapsed；计时不进入 status 内容，spinner 支持 reduced motion。新回复 follow 与真实向上读历史意图区分保留。
- **compact 行为**：只有 `AgentSessionPanel` 显式 opt-in；其他 `AssistCandidateReview` 调用保持展开式。修改数与主 Accept/Discard 常驻；diff、逐项按钮、全篇比较与下载放入 View changes；冲突、失败、空结果、权限和截断提示在折叠外。多项逐项接受及已接受禁用仍保留，单项没有重复接受按钮。
- **草稿、Save 与 direct**：编辑态 Accept 只调用同步草稿替换；`PageEditor.handleSave` 才发送携带 `expectedUpdatedAt` 的页面 PATCH。阅读态 `canAccept=false`，仅显式 direct 所登记的 turn 进入原 direct 路径；该路径继续检查页面/Space/能力/版本并走 CAS PATCH。笔记覆盖、无重放 ledger、Undo/Redo 和部分接受逻辑均沿用原实现，调整后的集成断言没有删除这些语义断言。

## 验证证据与范围

- 本审查实读日志：client 初版全量 **157 files / 2586 passed**；两项客户端修复后 **4 files / 260 passed**；滚动回归先 **2 failed** 后 **71 passed**；单项 Accept 回归先 **1 failed**。后续 client build 日志明确执行 `tsc && vite build` 并构建成功；lint/tsc 日志没有诊断。
- Server 实现回执记录：最终 **7 suites / 179 passed / 1 existing skip**，补充 legacy 断言后 queue-only **37 passed**，server build/typecheck/lint 成功。本审查没有独立重跑这些命令，也不把实现回执当作 PostgreSQL 并发验收。
- 本审查新执行 `git --work-tree="$PWD" diff --check 479419ef..b2620dc7`，退出 0。
- 本审查独立查看 `desktop-active-fixed.png`、`narrow-active-fixed.png`、`desktop-compact-final.png`：活动状态、7/8 秒耗时及 Stop 均未被 composer 裁切，单项候选常驻操作与默认折叠呈现符合要求。父级的 CUA 回执另外覆盖 Stop、展开 diff、Accept 后 API 未新增、显式 Save 后 API 新增及控制台无 error/warn；这些操作归属于父级浏览器验收，非本审查重复执行。
- 浏览器使用明确标注的合成 fixture。真实模型 provider、真实 PostgreSQL 并发与生产部署不是上述截图/单元测试的证明范围；本任务未部署、未做生产写入。

## 非阻塞备注

客户端最终构建的 initial JavaScript 为 **549902 / 550000 bytes**，距离现有预算仅 **98 bytes**；构建通过，Mermaid 循环 chunk 与大 chunk 警告已记录。此次没有新增阻塞，后续增加入口依赖时需要注意预算余量。
