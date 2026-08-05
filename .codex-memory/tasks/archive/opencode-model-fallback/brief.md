<!-- codex-memory:template=task-brief:v1 -->

# opencode-model-fallback

## 目标

为服务端 OpenCode 辅助写作增加免费模型优先、付费模型自动发现与成本排序、客观失败降级、Redis 共享熔断和 token/cost 记录。

## 当前状态

- 免费优先、失败条件、付费模型自动发现、默认开启付费降级、熔断、调用上限、配置与真实验收范围已获得用户逐项确认。
- 书面设计已落到 `agentwiki/docs/superpowers/specs/2026-08-04-opencode-model-fallback-cost-routing-design.md`。
- 本地业务实现、真实 OpenCode E2E、全仓门禁和独立代码复审已完成；复审结论 Approved。
- 真实 E2E：`opencode/big-pickle`、free、1 attempt、cost=0，临时 Space/User 删除后分别验证 404/401。
- 最终本地门禁：runtime 43 passed/9 skipped、server 343、client 124、local-sync 160；typecheck/lint/build/diff check 全通过。

## 下一步

- 获得明确发布授权后，先备份 PostgreSQL，再部署并完成公网真实辅助任务 smoke。
- 生产 smoke 通过前保持任务 active，不宣称已发布。
