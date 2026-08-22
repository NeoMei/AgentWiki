# Agent 统一访问角色

## 目标

将 Agent 的 Space Grant、连接码授权和 Credential 授权合并为一次角色选择，统一使用 `reader`、`editor`、`publisher`，修复 Agent 显示 editor 但 OpenCode Credential 缺少 `pages:write` 的问题。

## 当前阶段

- 需求、角色边界、数据流、界面、安全和验收设计已由用户确认。
- 用户明确不要求兼容旧版本客户端或旧版本权限数据。
- 正在固化设计文档；尚未开始生产代码实现。

## 范围

- 统一角色策略及 Grant/Credential 角色字段；
- Space + role 的一次性连接授权包；
- 原子兑换、幂等和审计；
- Agent 访问页、手工 Credential、本地同步与三客户端协议；
- MCP 权限回归和真实 OpenCode 验收。

## 不做

- 旧 `viewer` / `full` / 自定义 scopes 兼容；
- Agent 人工审批、成员管理或 `review:decide`；
- 自动修改 Space Policy。

## 下一步

1. 用户复核已提交设计文档。
2. 使用 writing-plans 编写 TDD 实施计划。
3. 经执行方式确认后开始实现与验证。
