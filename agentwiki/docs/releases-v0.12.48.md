# AgentWiki v0.12.48 / Local Sync v0.13.2（发布候选）

本候选修复 MCP 客户端接入范围、浏览器授权衔接和接入后的客户端提示。当前为未发布、未部署的候选；源代码测试和打包验证不代表真实 WorkBuddy 端到端验收完成。

- 通用 MCP 接入导出标准 stdio 配置；WorkBuddy 有专用配置入口，原有 Codex、Claude Code、OpenCode 继续支持。
- 启动接入先检查 Node.js 24/26，验证授权地址后尝试打开系统浏览器。浏览器打开不等于授权成功，仍由用户在页面授权。
- 接入结果明确区分网关配置、客户端 MCP/工具权限、客户端重启及新会话真实读页；未取得宿主读页证据时不能宣称验收完成。
- `doctor --all-clients` 可检查各客户端配置；CLI 帮助和不支持参数的报错已补齐。
- 自动化状态机测试使用注入的浏览器边界，不能再将 `wiki.test` 虚构授权地址打开到真实浏览器。

Web/API/client/root 版本同步到 0.12.48；Local Sync 固定到 0.13.2，包含运行时标识、接入请求/计划/会话 schema、安装命令、网关、随包 skill、服务端允许范围、Web 固定命令和对应契约。服务器继续接受 0.13.1 及此前受支持版本，保留每个请求的精确版本和 planHash；旧版本安装指令仍使用其支持的 `--agent auto`。sync protocol 保持已发布的 0.6.1，不重复发布。没有依赖升级或数据库迁移；pnpm lockfile 无需变更。

尚未完成的 0.13.1 及更早接入会话须继续使用该会话原有的精确版本命令。0.13.2 CLI 不恢复旧版本本地检查点，不要修改已保存的版本或 planHash。

正式发布前应完成并固化候选审查、构建和包门禁；先发布并校验 npm 0.13.2 的正式包，再一起部署 Web/API 0.12.48 与 `LOCAL_SYNC_PACKAGE_VERSION=0.13.2`。仅发布 npm 或仅部署网页都不足以开启本流程。之后在真实 WorkBuddy 运行浏览器授权、客户端权限确认、重启与 MCP 读页，并单独保存结果。准备和门禁状态见[候选记录](verification/generic-mcp-onboarding-20261018/release-candidate.md)。
