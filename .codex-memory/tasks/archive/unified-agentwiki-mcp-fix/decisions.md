# 决策

- 采用方案一：普通 Credential 保留为 API/脚本凭据；Agent 接入统一走现有 gateway。
- 不新增客户端专属服务端协议。服务端签发通用一次性安装码和 Agent Credential，客户端差异只留在本地配置适配层。
- 已有 Agent 复用公开 `onboard` 命令的 `--code` 分支，不恢复 `connect` 或第二个 MCP。
- gateway 固定名称为 `agentwiki`，统一路由 `wiki_*`、`local_*`、`knowledge_*`。
- 0.3.6 已发布且不可覆盖，因此修复版本为 0.3.7。
- npm 发布、合并和部署属于独立外部动作，不包含在本地实现任务中。
