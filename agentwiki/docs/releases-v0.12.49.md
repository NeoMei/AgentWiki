# AgentWiki v0.12.49 / Local Sync v0.13.3（正式发布）

本版本已于 2026-10-19 正式发布 npm 并部署生产，冻结源码为 `1e3fb14001ec33f1c77be1dbfe86f9b02406d382`。修正真实 WorkBuddy 接入时发现的授权轮询与 MCP 验证指引，并保护接入会话免于跨版本误续进；执行证据见[发布回执](verification/workbuddy-guidance-20261019/release.json)。

- 浏览器授权后按 `retryAfterMs` 执行无 `--reply-file` 的 `onboard continue`，从服务端取得授权并推进。CLI `onboard status` 只读取本地检查点，不能代替授权轮询。
- 指引使用真实存在的 MCP `onboard_status`、`wiki_list_spaces` 和 `wiki_get_page`。`onboard_status` 显示检查点及实时网关诊断，不证明当前 Agent 身份；不再要求不存在的 `wiki_identity`。
- 新会话在首次检查点持久化精确包版本；JSON 分步流程与旧式 resume 在推进前拒绝缺失或不匹配的版本标记，返回 `SESSION_VERSION_MISMATCH`，不改旧检查点或 token、不请求远端、不重建身份。用户须使用原始启动命令的精确包版本继续；MCP 历史状态诊断仍可只读查看。
- 网站指南、公开 `/api/onboard` 指令、CLI 帮助及安装后提示同步说明客户端 MCP/工具信任、完整重启或重载、新会话真实读页要求。自动化检查、配置写入与网关握手不能代替宿主验收。

Web/API/client/root 同步为 0.12.49，Local Sync 为 0.13.3；新增接入指令固定同版本。服务器继续接受 0.13.2 及此前受支持版本，0.13.2 保留 generic/WorkBuddy 指令，0.13.1 及更早版本保留原客户端模式。已有本地会话继续使用其原精确版本命令，不改已保存的版本、请求或 planHash；0.13.3 CLI 不迁移旧检查点。

sync protocol 保持已发布的 0.6.1，不重新发布；没有依赖升级、锁文件变更或数据库迁移。npm 0.13.3 官方 tarball 与冻结候选一致，175 文件及空目录/空缓存安装通过；Web/API 0.12.49 与 `LOCAL_SYNC_PACKAGE_VERSION=0.13.3` 已同步部署。生产 1357 源码零差异、3 服务 active、5 项健康通过，公网 HTML 和 5 个入口资源逐字节匹配。真实 Chrome 已刷新线上指南并展开 WorkBuddy 0.13.3 指令，公开 `/api/onboard` 八项指引核对通过。部署后既有 WorkBuddy 0.13.2 固定 Node24 连接再次真实调用 MCP 读页成功，原生 UI 与独立日志一致；这是新后端兼容验证，不等同于新的 0.13.3 接入验收。

## 真实验收与未解决边界

此前 0.13.2 的本机真实浏览器授权、客户端信任、两次完整重启及 Node 24 上的 MCP 读页已通过，证据见[真实 WorkBuddy 记录](verification/generic-mcp-onboarding-20261018/workbuddy-real-acceptance.md)。该闭环使用官方固定包、绝对 Node 24 可执行文件和稳定 CLI 路径的本机配置修正。当前本机继续保留官方 0.13.2 与固定 Node24 配置，未升级或重新创建身份。

本次包含指引修正与跨版本会话推进保护，不修复 WorkBuddy 原始 `npx` 启动的缓存 `safe-delete` 拒绝，也不改变其托管 Node 22 选择。默认 `npx` 安装路径仍未验收通过，不能把此前本机修正或本次源码/打包检查当作 0.13.3 默认流程的真实验收。
