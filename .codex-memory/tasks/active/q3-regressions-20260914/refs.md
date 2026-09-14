# 证据索引

- `assessment.md`：原 20 项静态核对。
- `.superpowers/q3/progress.md`：工作树执行记录。
- `.superpowers/q3/task-5-baseline.log`：Source/Authorization 基线 70 项通过。
- `.superpowers/q3/task-5-red.log`、`task-5-green.log`：来源诊断回归。
- 原测试报告：`/Users/neomei/项目/codexprojects/AgentWiki /测试报告/AgentWikiQ 3/问题清单-缺陷详情.md`。

- 最终验证：`agentwiki/docs/verification/q3-regression-repair-20260914.md`（20项复测步骤）。
- 主仓日志：`.superpowers/q3/server-final-title.log`（2663pass/4skip）、`client-final.log`（1503pass）、`build-final.log`及后续`server-build-title.log`、`lint-final-title.log`、`server-typecheck-title.log`。
- 插件最终日志：`/tmp/agentwiki-task4-round2-final-check.log`（1385pass、完整check通过）。早期195个reader兼容失败保存在`/tmp/agentwiki-task4-round2-check.log`，修复后无失败。
- Chrome：`/Users/neomei/.codex/recovery/agentwiki-q3-20260914/browser-results.json`，7/7。API为隔离fixture；图谱包含390px及CDP触摸。
- 独立审查：`.superpowers/q3/task-{1..5}-review.md`、`whole-branch-review.md`；整分支最终复审待报告收口。
