<!-- codex-memory:template=task-decisions:v1 -->

# 决策

- 动态发现 OpenCode 元数据确认的零成本活跃文本模型，免费模型优先。
- 仅客观技术失败或无效输出触发降级，不做内容质量自评。
- 付费模型由 OpenCode 自动发现并按本次任务的预计成本排序，不要求管理员维护 allowlist。
- `ASSIST_OPENCODE_ALLOW_PAID_FALLBACK` 默认 `true`，可显式关闭；每任务仍最多尝试 1 个付费模型。
- 单任务最多 3 个免费候选和 1 个付费候选，且共享 180 秒总预算。
- Redis 在 Worker 间共享模型熔断和半开探测锁；Redis 故障不能成为跳到付费模型的理由。
- 任务结果记录最终模型、tier、token、cost 和脱敏尝试摘要。
- 可选排除列表只用于禁用个别昂贵或不稳定模型，不作为必填配置。
- 第一版不实现成本报表、用户额度或前端模型配置。
