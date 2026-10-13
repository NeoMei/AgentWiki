# 当前目标

- 修正为 Agent 一次接入 AgentWiki，每次按 spaceId 的实时 AgentGrant 授权；解除目标项目空间的旧网关阻塞后，继续 MCP 文档模板改版。

# 范围 / 不做

- 本候选覆盖身份凭据、服务端鉴权、数据库迁移、MCP 网关、接入与协作准备界面和旧同步目录兼容。
- 用户已明确授权发布，正在执行 Web 0.12.25 / Local Sync 0.12.0 协调发布。文档远程读写仍只用 MCP。

# 当前状态

- 工作树 agent-identity-space-auth，分支 codex/agent-identity-space-auth，基于 origin/master 6de18645（v0.12.24）。
- 最终候选 c5a2cb75e022d55ba4ab927668c3b705ba4e07b0 已提交；服务端、客户端、网关及旧 Tree 工作区兼容修复全部通过独立复审。
- 在 c5a2cb75 上增加 MCP 原页面更新、创建页指定目录和版本元数据；独立审查通过。最终整树测试 7,114 通过、6 跳过、0 失败，其中 Runtime DB 232 零跳过；typecheck/lint/build/diff check 通过。
- 生产 SSH 和 npm 登录已恢复；配套数据库、附件、应用备份正在执行。外部发布、部署、MCP 升级均须单独验收回执。
- 目标 Space cmv6biedu005okoisb9fgp64y 仍未通过当前正式 MCP 实读；17 篇模板草稿尚未远程提交。

# 稳定约束

- 新设计以本轮用户明确纠正为准：不得继续要求逐 Space 接入码；旧凭据标识 Agent，权限按目标 Grant 动态读取。
- 路径有尾空格。Git 必须正确 cwd 与显式 --work-tree；禁止修改共享 core.worktree 或重置主检出资料。
- 旧 key 保留生命周期，撤销一个 Grant 不撤销其他 Space；全局停用和撤销仍立即拒绝。不得跨身份自动回退。
- 数据库测试仅隔离测试库/随机 schema。已实现、独立审查、发布、本机升级、实际 MCP 回读分别记录。

# 关键索引

- .codex-memory/tasks/active/agent-identity-space-auth-20261013/{brief,decisions,refs}.md
- agentwiki/docs/superpowers/specs/2026-10-13-agent-identity-space-authorization.md
- agentwiki/docs/superpowers/plans/2026-10-13-agent-identity-space-authorization.md
- 模板草稿：/Users/neomei/.codex/visualizations/2026/10/13/01a1348e-515b-7fc2-95d5-97af8c721c44/agentwiki-project-template-v2/

# 风险 / 下一步

- 完成配套备份后，发布 npm、生产服务端/前端/数据库和 GitHub Release；再升级本机现有 MCP，回读目标 Space。
- 新数据库允许未绑定 Grant 的凭据；发布需服务端/网关协调，旧服务端不能直接配新数据回滚。
- MCP 原页面更新能力已补齐；恢复访问后按原页面 ID 提交 17 篇模板并回读正式文档。不能把本地模板或接入修复等同线上文档完成。
