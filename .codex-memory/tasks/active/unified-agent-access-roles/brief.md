# Agent 统一访问角色

## 目标

将 Agent 的 Space Grant、连接码授权和 Credential 授权合并为一次角色选择，统一使用 `reader`、`editor`、`publisher`，修复 Agent 显示 editor 但 OpenCode Credential 缺少 `pages:write` 的问题。

## 当前阶段

- 本地生产代码、数据库迁移、前端、sync-protocol、local-sync、onboarding、MCP 回归和文档已完成。
- 旧 Agent `approvalMode` 请求旁路、0.4.0 部署默认、仍发送旧字段/scopes 的 onboarding/cross-machine/smoke E2E fixture 和未使用的 `agent.viewer` 文案键已在最终扫描中修复。
- 提交态全仓构建、测试、类型、lint、Prisma、三客户端 onboarding、打包和静态扫描均通过。
- 任务仍保持 active，等待用户单独授权发布、生产部署和真实 OpenCode 验收。

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

1. 等待用户单独授权 push、npm 0.5.0 发布和生产部署。
2. 部署前创建并验证数据库 custom dump 和应用回滚包，记录指纹。
3. 发布后用新 Editor 连接完成真实 OpenCode 提案、Agent 不可审批和人工审批后内容确认。
