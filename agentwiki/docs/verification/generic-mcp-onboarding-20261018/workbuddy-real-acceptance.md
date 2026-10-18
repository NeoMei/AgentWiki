# WorkBuddy 本机真实验收进展

执行时间：2026-10-18晚至2026-10-19（Asia/Shanghai）。本记录保留发布前旧连接证据，并持续记录发布后新版本实际接入；新流程尚未通过。

## 发布前的新接入实际阻断（历史）

在本机 Node 24.18.0 运行候选 CLI，真实请求生产 `onboard start --server https://agentwiki.quukk.com/api --client workbuddy --protocol json`。生产 `/api/onboard/device/start` 返回 HTTP 400：`clientType must be one of the following values: codex, claude, opencode`。没有打开浏览器，没有完成授权或创建新 Agent；没有将 clientType 伪装成 codex 绕过。

该阻断发生在发布前旧生产。用户随后已批准固定`0a299231`发布；npm0.13.2官方包/175文件/空缓存安装及Web/API0.12.48生产1357源码/公网HTML和5资源已验证通过，详见release.json。授权持续有效，不需重新取得发布批准。

## 已有连接的真实宿主验证

- WorkBuddy 5.8.3 的自定义 MCP 管理显示 `agentwiki` 启用、34/34工具启用。会话使用用户原有“允许完全访问”策略，没有出现新的授权弹窗；本次未扩大权限或修改配置。
- 通过原生界面完全退出 WorkBuddy，进程检查确认旧进程消失，然后重新启动。主PID由55861变为85486；新会话在重启后创建。
- 新会话中让WorkBuddy只使用本身注册的MCP工具，不使用终端、curl或脚本。其原始会话日志确认ToolSearch之后有6次DeferExecuteTool调用：onboard_status、wiki_list_spaces、3次wiki_list_pages、wiki_get_page，没有其他执行工具。
- `onboard_status` 当前gateway为connected / REMOTE_CONNECTED；其中旧会话的failed_terminal明确标注historical，未冒充当前失败或成功证据。
- `wiki_list_spaces`返回原有“AgentWiki 项目”空间、publisher权限。权限来自用户之前的连接，本次未新增grant。
- 前两次list_pages因返回内容超过WorkBuddy限制而落盘，宿主改用take=3取得3页，再按页内链接读取《00 项目总览｜模板案例导航》。get_page成功返回8156字节UTF-8正文，updatedAt为2026-10-13T17:32:33.445Z。
- WorkBuddy界面显示实际读页结果；原始工具结果的正文SHA256为`34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b`。

这是已发布0.13.1和既有身份的真实权限/重启/宿主读取证据，**不是0.13.2新浏览器接入流程验收通过**。该旧连接验证阶段没有改用户MCP配置、创建新Agent、上传知识或写页面。

## 发布后的0.13.2真实启动：浏览器已自动打开，用户授权待完成

新真实WorkBuddy会话 `c3b10b4e-5a05-4f1b-9f8e-d9b9a0ada18f` 使用官方0.13.2包。原始`npx`入口在宿主内遇到`safe-delete`拒绝操作缓存`concurrency.lock`，未跑通。随后WorkBuddy在任务目录以`npm install`安装官方包并直接运行已安装CLI；这是实际采用的启动路径，不能将其成功写成原始`npx`命令已通过。

已安装CLI真实执行`clientType=workbuddy`接入后返回`browserOpened=true`，系统自动打开真实Chrome授权页，主任务观察到`https://agentwiki.quukk.com/onboard/device`以及“WorkBuddy Agent 连接 0.13.2”页面。此页不是wiki.test或模拟页面，也不是只凭系统打开命令退出码判定。会话日志与实际浏览器观测整理在私有`0132-browser-start-proof.json`。

当前`accountAuthorization=pending_user`、`hostVerification=not_started`。只确认“真实宿主运行官方已安装CLI→自动打开实际授权页”这一步；用户授权、后续安装计划、新配置生效、客户端权限、重启及新会话MCP读页尚未通过。原始npx入口的宿主兼容问题仍须解决或明确保留边界。

## 证据与剩余步骤

原始生产错误、权限截图、重启进程回执、宿主UI截图及脱敏工具回执保存在本机`/tmp/agentwiki-workbuddy-acceptance-20261018/`。用户原始会话日志保留在WorkBuddy项目目录；私有正文、截图、凭据和完整授权URL不提交仓库。

下一步由用户在已自动打开的真实页面授权，然后继续同一会话的安装计划/权限确认、新配置、WorkBuddy重启和新会话MCP读页。旧0.13.1连接成功、发布/健康成功以及本次授权页打开成功均不能填补未执行的后续步骤。正式发布已完成，无需重复publish/deploy；原始npx路径尚未验收通过。
