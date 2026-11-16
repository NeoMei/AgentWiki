# AgentWiki v0.12.67

修复 Agent 每次启动 MCP 都要通过 npx 联网拉取 Local Sync 包、在没有科学上网的电脑上导致 MCP 连接超时的问题。

- 接入时把固定版本的 Local Sync 包一次安装到 `~/.agentwiki/runtime/local-sync-<version>`，校验包名、版本与本地 CLI。
- 所有宿主（Codex、Claude Code、OpenCode、WorkBuddy、通用 MCP）的 MCP 配置改为写入该 Node 与本地 CLI 的绝对路径；启动 MCP 直接执行本地文件，不再运行 npx、解析包或访问 npm 源。
- 退役 WorkBuddy 专用 npx 缓存 runner 与启动准备步骤；旧的 npx 配置在重试接入时升级为本地运行时，配置回滚仍按确认的配置哈希校验。
- 生成指令、服务端版本契约与文档统一为 Local Sync 0.13.6；服务端兼容列表保留 0.13.5 及更早版本，不影响既有会话。
- 连接校验改为回读宿主实际会执行的本地命令，避免用网络安装是否成功替代启动路径检查。

Web/API/Client 为 0.12.67；Local Sync 为 0.13.6；同步协议保持 0.6.1。旧版 Local Sync 接入仍保持兼容，既有会话继续使用原固定版本命令。0.13.6 接入要求本次 Web/API 0.12.67 或更新版本。本次不新增数据库迁移或固定 OpenCode 依赖。

本地门禁：客户端 2949/2949、Local Sync 1106/1107（1 条件跳过）、服务端 3718/3797（79 条件跳过）、Local Sync 安装服务 82/82；类型检查、lint、全包构建与 `git diff --check` 通过。npm 发布、生产部署与真实客户端启动验收分别单独留证。
