# Final release candidate audit

## 目标

- 全面审计 `origin/master..HEAD` 的任务完整性、代码正确性、前后端功能与 UI 交互，经过多轮发现、修复、复审和新鲜验证后得出最终结论。

## 当前状态

- 2026-09-04 启动；执行计划为 `agentwiki/docs/superpowers/plans/2026-09-04-final-release-candidate-audit.md`，计划提交 `686ba4f`。
- 首轮三视角只读审查和新鲜全仓测试进行中。
- 上一轮 macOS 验证的 `4a9ac92` 和 4209/0/3、CodeGraph 1/1、Playwright 25/25 仅作为预期基线，不作为本轮最终证据。

## 范围 / 不做

- 仅在当前隔离工作区修复和验证，不触碰原 Mac 脏工作区。
- 未获得本轮 push、npm 发布或生产部署授权，不执行这些动作。

## 完成条件

- 任务完整性和整分支代码均完成至少两轮独立审查，不遗留 Critical/Important，Minor 逐项裁决。
- 所有有效 bug 均有根因、RED 回归、最小修复、GREEN 及 scoped re-review。
- 最终代码提交上的全仓测试、typecheck、lint、build、真实 CodeGraph 和 Chrome Playwright 7/25 全部通过。
- clean clone 复验通过，随机 schema、附件、进程、容器和四个端口完成精确清理。
- 正式证据与项目记忆更新后，任务转入 archive。
