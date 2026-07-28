# 通用 Agent 接入指南文案设计

## 目标

明确 AgentWiki 提供的是通用 Agent 接入方式，而非 OpenCode 专属集成。OpenCode 继续作为经过真实验证的演示客户端，用于展示从接入到发布 Wiki 页面的完整结果。

## 文案层级

1. 指南标题、步骤标题和核心说明以“本地 Agent”或“任意 Agent”为主语。
2. 在操作步骤中说明：把 AgentWiki 生成的完整接入指令交给本地 Agent，由 Agent 自行配置 MCP、校验身份并报告结果。
3. Codex、Claude Code、OpenCode 等产品作为兼容示例出现，不把任何一个产品写成唯一入口。
4. OpenCode 的真实截图与发布结果保留，并明确标记为“以下以 OpenCode 为例”。

## 协议边界

- 接入协议保持不变：AgentWiki 生成凭据专属 MCP 连接名、MCP 地址和 Authorization 请求头。
- 授权仍由 AgentWiki 服务端决定，客户端名称不参与权限判断。
- 只支持 stdio 的 Agent 客户端继续通过 `mcp-remote` 桥接，因此不同 Agent 使用的是同一套服务端能力。

## 修改范围

- 更新 `UsageGuide.tsx` 中第 5、6 步及相关说明的中英文文案。
- 必要时调整截图说明文字，但不替换已经验证的真实 OpenCode 截图。
- 更新 `UsageGuide.spec.tsx`，断言通用 Agent 接入语义以及 OpenCode 示例语义同时存在。
- 检查生成的接入指令，确保其仍明确区分通用协议与 OpenCode 命令示例。

## 验收标准

- 用户不再可能从指南中理解为“只有 OpenCode 可以接入”。
- 用户能看懂所有本地 Agent 都遵循同一套接入流程。
- OpenCode 被明确描述为演示案例，而不是 AgentWiki 的唯一客户端。
- 中文和英文文案保持一致。
- 客户端测试、lint、类型检查和构建通过。
