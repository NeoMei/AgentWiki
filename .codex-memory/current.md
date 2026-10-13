# 当前目标

- 继续通过 MCP 完成 AgentWiki 项目空间 `cmv6biedu005okoisb9fgp64y` 的 17 篇日常项目管理模板：功能表、任务计划、测试报告、修复反馈、开发日志与人机协作规范。

# 范围 / 不做

- Agent 一次接入、按 spaceId 实时授权的修正已发布。当前推进模板文档远程交付；远程文档读写只用 MCP。
- 用户已授权软件发布，并明确允许 Publisher 自动发布。主代理正在应用审核政策后推进文档；不得把授权或 pending_review 当作正式发布。

# 当前状态

- 工作树 agent-identity-space-auth，分支 codex/agent-identity-space-auth；发布提交 `48781e5b192101a2d122dd143048d983bca8a29b`，GitHub `v0.12.25` 与 npm Local Sync `0.12.0` 已发布，协议保持 `0.6.1`。
- 最终整树测试 7,114 通过、6 跳过、0 失败；Runtime DB 232 零跳过；typecheck/lint/build/diff check 与独立复审通过。
- 生产备份、数据库迁移、1,252 文件源码校验、三项服务及内公网 health/网页资源均已验收。旧凭据/Grant 稳定字段保留，活动时间不纳入在线比较；各正常新增 1 条单独记录。
- 原本机连接已升级 0.12.0，Agent/connection/key/其他配置保持。公开包 stdio MCP 实读 3 个授权 Space，目标项目为 publisher，15 页、5 目录、首页均成功；未声称当前 Codex 工具进程热重载。
- 目录改名已有 pending_review 提案。17 篇模板正式发布和逐页回读尚未完成；用户刚授权 Publisher 自动发布，主代理推进中。

# 稳定约束

- Agent 只接入一次；不得要求逐 Space 接入码。旧凭据标识 Agent，权限按目标 Grant 动态读取，禁止跨身份或其他凭据回退。
- 路径有尾空格。Git 必须正确 cwd 与显式 --work-tree；禁止修改共享 core.worktree 或重置主检出资料。
- 撤销一个 Grant 不撤销其他 Space；全局停用/撤销仍立即拒绝。旧 Tree 数据与未提交文件保持。
- 已实现、独立审查、发布、本机升级、实际 MCP 回读及文档正式发布分别记录；测试仅用隔离库。

# 关键索引

- .codex-memory/tasks/active/agent-identity-space-auth-20261013/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-identity-space-auth-20261014/{status.md,publication-progress.json,production-receipt-0.12.25.json,mcp-live-readback-receipt.json}
- 模板草稿：/Users/neomei/.codex/visualizations/2026/10/13/01a1348e-515b-7fc2-95d5-97af8c721c44/agentwiki-project-template-v2/

# 风险 / 下一步

- 按用户授权应用 Publisher 审核政策，再通过 MCP 按原页面 ID 更新、创建缺失的测试报告/开发日志，解析真实页面链接并逐页回读。
- 新数据库允许未绑定 Grant 的凭据；回滚必须恢复匹配数据库与应用，不得单独部署旧服务端。
- 保留角色/审核策略与实际 MCP 写入状态的证据；软件发布成功不能代替模板内容交付。
