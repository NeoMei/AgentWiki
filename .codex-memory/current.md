# 当前目标

- 已完成 Agent 一次接入、按目标 spaceId 实时授权修正及正式发布；原 AgentWiki 项目模板站点已通过 MCP 完成交付。

# 范围 / 不做

- Web 0.12.25 / Local Sync 0.12.0 / protocol 0.6.1；目标 Space cmv6biedu005okoisb9fgp64y 的 5 个目录、17 篇模板。
- 历史缺陷与人工验收不因本次发布而批量关闭。

# 当前状态

- 正式部署源码 48781e5b192101a2d122dd143048d983bca8a29b；GitHub v0.12.25 与 npm 0.12.0 已发布。7,114 pass / 6 skip / 0 fail，typecheck/lint/build 与独立审查通过。
- 生产迁移、1,252 文件、3 服务、5 health、32 烟测已验；原 71 凭据、482 Grant 稳定字段保留；配套备份可追溯。
- 用户明确授权目标空间 Publisher 限定范围自动发布，空间策略已保存；Agent 原已允许。原连接与凭据保留，3 授权 Space 实读通过。
- 15 页原位更新 + 2 页新建，最终 17 页标题/正文/目录/Agent 审计回读一致；110 内链有效。模板30功能/12需求/11任务/18用例/6报告/12反馈/7日志，42验收条件。

# 稳定约束

- Agent 身份一次接入，按目标实时 Grant 授权，不再索取逐 Space 接入码；不得跨身份回退。
- 文档正式读写用 MCP，发布与最终回读分开留证；空值与历史状态不得伪造。
- 工作树路径有尾空格；Git 显式 --work-tree，保留主检出用户工作。

# 关键索引

- .codex-memory/tasks/archive/agent-identity-space-auth-20261013/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-identity-space-auth-20261014/status.md
- agentwiki/docs/verification/agent-identity-space-auth-20261014/template-final-publication-receipt.json
- 项目首页：https://agentwiki.quukk.com/pages/f285b898-65ba-4938-8616-e9a0b8f575f5

# 风险 / 下一步

- 本轮交付已完成，后续按模板维护日常项目进展。
- 当前旧聊天 MCP 进程未热重载；本机配置已升级，新启动官方0.12.0网关已实测，原连接不变。
- 批量 MCP 调用应节流（本次至少3.25秒/调用）；原429已通过核对保存结果恢复。侧栏保留既有sortOrder，首页按流程提供导航；旧目录候选仍pending但已被正式发布替代。
