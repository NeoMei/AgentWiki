<!-- codex-memory:template=task-brief:v1 -->

# opencode-model-fallback

## 目标

为服务端 OpenCode 辅助写作增加免费模型优先、付费模型自动发现与成本排序、客观失败降级、Redis 共享熔断和 token/cost 记录。

## 当前状态

- 免费优先、失败条件、付费模型自动发现、默认开启付费降级、熔断、调用上限、配置与真实验收范围已获得用户逐项确认。
- 书面设计已落到 `agentwiki/docs/superpowers/specs/2026-08-04-opencode-model-fallback-cost-routing-design.md`。
- 用户已确认书面 spec；实施计划已落到 `agentwiki/docs/superpowers/plans/2026-08-04-opencode-model-fallback-cost-routing.md`，当前等待选择执行方式，未开始业务代码实现。

## 下一步

- 按选定执行方式逐任务进行 RED-GREEN-REFACTOR 和独立提交。
- 完成本地真实 OpenCode E2E、全仓门禁与安全审查。
- 生产发布必须先备份并完成真实辅助任务 smoke。
