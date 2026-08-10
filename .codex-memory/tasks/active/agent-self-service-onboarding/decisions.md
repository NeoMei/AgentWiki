<!-- codex-memory:template=task-decisions:v1 -->

# 决策

- 采用完整 A 路径：从账号注册/登录一直完成 MCP、首次扫描和首次同步。
- 注册与登录采用网页 Device Auth；密码和第三方登录信息不进入 Agent 对话。
- Device Auth 是 AgentWiki 自有的 first-party device flow，不要求第三方 OAuth Provider。
- Agent 与脚本采用 NDJSON schema/response 填空协议；human 模式只作为直接终端后备。
- 接入计划汇总后确认一次；首次同步内容预览必须单独确认。
- 完整流程只安装一个本地 `agentwiki` gateway MCP，不同时安装 direct remote MCP。
- 网关使用 `wiki_*`、`local_*`、`knowledge_*` 工具前缀和固定注册表确定执行平面。
- 正常流程使用高层组合工具；不保留旧低层工具 alias。
- 远程工具由 RemoteMcpBridge 代理 `/api/mcp`，避免复制第二套 REST 业务语义。
- 安装使用精确版本、非交互命令、原子配置、并发 hash 校验、独立 deadline 和结构化错误。
- 宿主 Agent 不支持热加载时，独立验证 gateway 后返回 reload_required，不等待宿主刷新。
- bootstrap、安装、扫描和同步均可由 session/checkpoint 幂等恢复。
- bootstrap 只接收 serverPlan；扫描路径、Adapter 选择和本地配置 diff 属于 localPlan，永不上传。
- 目标版本为 local-sync 0.3.0，并明确作为破坏性简化版本；不保留 0.2.9 connect、remote-only 安装分支或旧状态迁移。
- 旧客户端配置先完整备份，再一次性替换为唯一 gateway；旧本地状态只归档，不做语义迁移。
- 完整 onboarding 因首次同步必做，只提供 `editor` 与 `full` 权限预设；`viewer` 仅允许接入完成后由 Space 管理员降级设置。
