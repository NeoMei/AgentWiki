# AgentWiki v0.12.50 / Local Sync v0.13.4

本版本修复 WorkBuddy 默认接入流程中 npm 释放缓存锁被 safe-delete 拒绝的问题。拦截发生在 AgentWiki CLI 执行前，因此网页、公开 API 的首次启动指令和安装后的 MCP 启动配置都需要处理缓存位置。

- WorkBuddy 首次启动先选择 Node.js 24 或 26 及其配套 npm/npx，在系统临时目录创建专属私有缓存；后续分步命令保留精确版本、缓存与原会话。通用 MCP 指令在实际宿主是 WorkBuddy 时采用相同准备。
- WorkBuddy 的 MCP 配置由安装器自动生成，绑定受支持的 Node 和官方 npm/npx，以专属临时缓存运行固定版本包。每次启动检查缓存目录，缺失时以私有权限重建，异常目录直接拒绝。不会关闭安全保护、修改 NODE_OPTIONS 或删除用户原有 npm 缓存。
- 安装验证使用实际写入的命令、参数和环境。WorkBuddy 冷启动允许更长的下载时间；验证结束清理本次启动的子进程，防止超时留下网关。
- 服务器继续支持 0.13.3、0.13.2 及此前兼容版本；已有接入会话仍须使用创建它的精确包版本，不迁移检查点或重新创建身份。

Web/API/client/root 为 0.12.50，Local Sync 为 0.13.4；sync protocol 保持 0.6.1。没有依赖升级、锁文件变更或数据库迁移。

Local Sync 0.13.4 已发布到 npm，官方 version/latest、tarball 哈希、179 文件及空缓存安装均已核对。Web/API 0.12.50 已在协调备份后从冻结提交 `99b247c7` 部署，生产 1360 源文件一致、3 服务与 5 项健康正常，公网 HTML 和 5 入口资源匹配。真实 Chrome 线上指南与公开 API 已确认首次 npx 前的缓存准备和权限/重启提示。

真实 WorkBuddy 使用正式 0.13.4 安装器生成的 npx 配置，在保留 reader 身份与授权的情况下，重新信任后完成冷启动，34/34 工具启用。再次完全退出、重开新会话后，MCP 诊断、空间查询与读页均成功；目标页正文 8156 字节，哈希与预期一致。客户端缓存内正式包 179 文件匹配，npm 日志确认 Node24.18.0 / npm11.16.0。最终候选 1121 测试通过、1 既有 Windows skip，独立审查无开放问题。

另在真实 WorkBuddy Bash 中验证正式 0.13.4：保持 NODE_OPTIONS，同次 Bash 的前置 Node 探针确认 language/safe-delete 两个 shim 已加载；使用全新系统临时私有缓存，官方 npx 冷、热启动均退出 0，未遇删除拦截。该探针不代表 npx 进程内部观测，证据见 [native-cache-0134.json](verification/workbuddy-npx-20261019/native-cache-0134.json)。

本轮账号授权沿用此前真实授权，没有重新创建身份或声称完成全新账号授权；Windows 原生宿主与备份恢复演练未执行。完整范围及历史对照见[验收说明](verification/workbuddy-npx-20261019/acceptance.md)。
