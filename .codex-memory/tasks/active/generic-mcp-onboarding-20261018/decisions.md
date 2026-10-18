# 决策

- 默认 generic，支持具有本地 stdio MCP 能力的宿主；不猜未知配置路径。generic 导出 `~/.config/agentwiki/mcp.json`，WorkBuddy 使用 `~/.workbuddy/mcp.json`，保留旧三客户端快捷项。
- Node24/26 在授权/换码/写状态前检查；自动打开仅同源授权 URL。浏览器启动不等于用户授权，授权后必须用 continue 按返回间隔轮询，CLI status 只读本地检查点。
- 浏览器授权、客户端 MCP/工具信任、完整重启或重载、新会话真实读页分别记证；配置与网关成功不能替代宿主验收。测试注入浏览器依赖，真实 opener 必须零调用。
- 同名未知 MCP 先拒绝；用户保留或重命名冲突条目后继续原 session，不重建身份。doctor 可选宿主缺配置为 unverified，不冒充注册。
- 0.13.3 为本轮新发布；Web/API 同步 0.12.49，protocol 仍为 0.6.1。服务器保留 0.13.2 generic/WorkBuddy 指令及此前版本兼容，不以旧版本号重发新代码。
- 新的 JSON steps 与 legacy checkpoint 持久化根级精确包版本；缺失或不匹配 marker 在任何推进、远端请求或 token 清理前拒绝。用户按原始启动命令的精确包继续，不能补写旧 marker/version/planHash；MCP 历史诊断保持只读。
- 用户明确“发布”授权持续有效。本轮从 `1e3fb14001ec33f1c77be1dbfe86f9b02406d382` 冻结导出发布；后续文档不改变源码和包。npm 正式 metadata、tarball 与空缓存安装都通过后才算发布可用，publish exit0 单独不足。
- 密钥验证由用户在真实认证页完成，SSH 由用户终端建立会话；不索取或输出密码、OTP、私钥。认证中断不撤销发布授权。
- 协调备份需配套数据库/应用/配置/附件并恢复 writers；不得自动恢复覆盖快照后的用户写入。未做恢复演练不得称恢复能力已实测。
- 本轮保留已验证的 WorkBuddy 官方 0.13.2 + 绝对 Node24/CLI 配置，部署后验证该旧客户端与新后端读页兼容；不把旧连接兼容写成新的 0.13.3 默认接入通过。
- 默认 WorkBuddy npx safe-delete 与托管 Node22 仍未修复。本机 0.13.2 真实闭环依赖本机运行时修正，外部验收独立于 CLI hostVerification 仍 not_started；身份来自实际 argv 和本地映射，非 onboard_status 当前身份字段。
- 旧 0.13.2 发布/回执/原始浏览器错误及两次重启证据留在 generic-mcp-onboarding-20261018，不覆盖、不改写为本轮结果。

- 本轮 npm 与生产发布已有独立回读，1357 源码与冻结提交匹配；生产发布完成不代表 0.13.3 全新接入完成。真实 Chrome/API 指南与既有客户端部署后 MCP 读页均已通过并分别保留证据。旧客户端配置未改、未重采进程，既有 Node24 的实际运行证明不得伪写成本轮重验；没有新发起 0.13.3 授权。
