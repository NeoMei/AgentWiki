# WorkBuddy 本机真实验收进展

执行时间：2026-10-18 23:56 至 2026-10-19 00:09（Asia/Shanghai）。本记录区分已有连接的真实读取与尚未通过的新版本接入流程。

## 新接入实际阻断

在本机 Node 24.18.0 运行候选 CLI，真实请求生产 `onboard start --server https://agentwiki.quukk.com/api --client workbuddy --protocol json`。生产 `/api/onboard/device/start` 返回 HTTP 400：`clientType must be one of the following values: codex, claude, opencode`。没有打开浏览器，没有完成授权或创建新 Agent；没有将 clientType 伪装成 codex 绕过。

候选已准备为 Web/API 0.12.48、Local Sync 0.13.2，提交 `0a299231`，包与版本门禁见release-candidate.md。npm发布与生产部署待用户确认，尚未执行。完整浏览器授权必须在服务器和新包一致后继续。

## 已有连接的真实宿主验证

- WorkBuddy 5.8.3 的自定义 MCP 管理显示 `agentwiki` 启用、34/34工具启用。会话使用用户原有“允许完全访问”策略，没有出现新的授权弹窗；本次未扩大权限或修改配置。
- 通过原生界面完全退出 WorkBuddy，进程检查确认旧进程消失，然后重新启动。主PID由55861变为85486；新会话在重启后创建。
- 新会话中让WorkBuddy只使用本身注册的MCP工具，不使用终端、curl或脚本。其原始会话日志确认ToolSearch之后有6次DeferExecuteTool调用：onboard_status、wiki_list_spaces、3次wiki_list_pages、wiki_get_page，没有其他执行工具。
- `onboard_status` 当前gateway为connected / REMOTE_CONNECTED；其中旧会话的failed_terminal明确标注historical，未冒充当前失败或成功证据。
- `wiki_list_spaces`返回原有“AgentWiki 项目”空间、publisher权限。权限来自用户之前的连接，本次未新增grant。
- 前两次list_pages因返回内容超过WorkBuddy限制而落盘，宿主改用take=3取得3页，再按页内链接读取《00 项目总览｜模板案例导航》。get_page成功返回8156字节UTF-8正文，updatedAt为2026-10-13T17:32:33.445Z。
- WorkBuddy界面显示实际读页结果；原始工具结果的正文SHA256为`34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b`。

这是已发布0.13.1和既有身份的真实权限/重启/宿主读取证据，**不是0.13.2新浏览器接入流程验收通过**。本次没有改用户MCP配置，没有创建新Agent，没有上传知识或写页面。

## 证据与剩余步骤

原始生产错误、权限截图、重启进程回执、宿主UI截图及脱敏工具回执保存于本机 `/tmp/agentwiki-workbuddy-acceptance-20261018/`。用户的原始会话日志仍在WorkBuddy项目目录。生产正文、截图、凭据不提交仓库。

剩余：取得具体发布许可，发布并核对0.13.2、部署Web/API0.12.48；再真实启动WorkBuddy接入，确认正常加载授权页、用户授权、安装计划与权限，完成新配置后重启并在新会话读页。浏览器授权与新身份/凭据变更必须按实际页面和计划确认，不能用旧连接读页或模拟授权填补。
