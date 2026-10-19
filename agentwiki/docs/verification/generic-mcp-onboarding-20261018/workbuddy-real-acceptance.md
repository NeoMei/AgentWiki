# WorkBuddy 本机真实验收进展

执行时间：2026-10-18晚至2026-10-19（Asia/Shanghai）。本记录保留发布前旧连接与Node22失败边界。本机经固定官方0.13.2包和绝对Node24路径修正后，真实授权、信任、重启及MCP读页闭环已通过；默认npx安装路径仍未通过。

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

## 发布后的0.13.2真实授权、安装与首次读页

新真实WorkBuddy会话 `c3b10b4e-5a05-4f1b-9f8e-d9b9a0ada18f` 使用官方0.13.2包。原始`npx`入口在宿主内遇到`safe-delete`拒绝操作缓存`concurrency.lock`，未跑通。随后WorkBuddy在任务目录以`npm install`安装官方包并直接运行已安装CLI；这是实际采用的启动路径，不能将其成功写成原始`npx`命令已通过。

已安装CLI真实执行`clientType=workbuddy`接入后返回`browserOpened=true`，系统自动打开真实Chrome授权页，主任务观察到`https://agentwiki.quukk.com/onboard/device`以及“WorkBuddy Agent 连接 0.13.2”页面。此页不是wiki.test或模拟页面，也不是只凭系统打开命令退出码判定。会话日志与实际浏览器观测整理在私有`0132-browser-start-proof.json`。

首次授权在继续时已过期，正式CLI沿同一session续期开启新的真实授权页，随后观察到该页已允许。计划确认与安装由主任务直接执行同一官方CLI继续，未将其描述为WorkBuddy Agent自主完成全部安装步骤。

真实浏览器中的允许操作已完成，同一接入session创建reader Agent `cmve2uzzo00atx1bm3j91lo13`（WorkBuddy 接入验收 0132）。CLI返回`status=completed`、`gatewayVerification=passed`、`connectionStatus=connected`，并保存安装备份`workbuddy-2026-10-18T170643361Z`。它同时明确`clientReloadRequired=true`和`hostVerification=not_started`，因此不能把安装completed当成宿主验收完成。

WorkBuddy第一次完整重启已观察到旧主PID85486全部退出，再启动为15551。首次客户端信任提示出现后，MCP状态变为绿灯34/34；主任务没有点击第一次信任按钮，只观察到状态变化，不能将该批准动作归因给主任务。

重启后的真实会话`b1ea8cb0-86b4-4524-83fb-7647be824a65`原始日志确认`wiki_list_spaces`返回reader空间、`wiki_get_page`读取已知页成功，正文8156 UTF-8字节、SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b`。读页实际使用宿主MCP；随后存在任务本地记忆的Bash/Write操作，未代替MCP检索。该成功属于新reader身份和0.13.2，不是旧0.13.1证据。

然而，独立进程核验发现宿主MCP继承WorkBuddy托管Node`v22.22.2`运行官方0.13.2，不满足包声明的Node24/26。首次读页确实成功，但不能据此标记完整接入已通过。另实测没有`wiki_identity`工具，`onboard_status`也不返回当前connection/Agent身份；身份依据是本地连接映射与进程参数绑定，不能声称不存在的工具验证成功。对应脱敏证据在私有`0132-host-read-proof.json`。

## 本机固定官方Node24运行时：第二次重启后真实读页通过

主任务将官方0.13.2稳定安装于`~/.agentwiki/runtime/local-sync-0.13.2`，逐项核对175文件与官方包一致；备份原配置后，将WorkBuddy MCP改为`/usr/local/bin/node`和绝对`dist/cli.js`路径，继续使用同一接入session。配置备份为`workbuddy-0132-before-node24-20261019T0115.json`，见私有`0132-node24-config.json`。

随后第二次完整退出PID15551，确认所有WorkBuddy进程消失，再启动主PID20291。主任务明确点击官方Node24配置的客户端信任，观察到agentwiki绿灯34/34。第一次信任动作仍不归因于主任务。

这是对本机当前连接的运行时修正，不代表发布版默认npx路径已通过：最初npx接入启动遇到safe-delete拒绝，生成的npx网关配置又继承了Node22。针对误导身份诊断和授权轮询指引的源码补修`d23bd089`已提交且测试通过，但尚未发布；正式LocalSync0.13.2/Web0.12.48仍对应冻结`0a299231`。该指引修复也不能被宣称已修好宿主safe-delete或默认托管Node22兼容问题。

独立最终证明`0132-node24-host-read-proof.json`核对了第二次新会话`f3aa7904-b547-48c6-a20b-5cc304aa5508`的原始工具调用、实际进程和官方包：

- 真实宿主只调用ToolSearch与MCP派发，没有Bash、HTTP、记忆读写替代。`onboard_status`、`wiki_list_spaces`、两次`wiki_get_page`均completed；空间grant为reader。
- 两次实际读页均返回《00 项目总览｜模板案例导航》，8156 UTF-8字节，SHA256均为`34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b`，未提交正文。
- gateway PID24353实际可执行文件为`/usr/local/bin/node`，实测`v24.18.0`；argv指向稳定官方0.13.2绝对CLI和同一connection，祖先链归属WorkBuddy主PID20291。不是仅查看配置文件推断运行时。
- 运行目录175文件全部与冻结官方tarball匹配；包版本0.13.2，命令connection与本地registry的reader Agent `cmve2uzzo00atx1bm3j91lo13`和目标Space一致。
- 身份绑定依据实际argv和本地映射，不是`wiki_identity`或`onboard_status`的当前身份返回。`onboard_status`仍显示标注historical的旧checkpoint与当前gateway连通；CLI安装结果中的`hostVerification=not_started`没有被改写。这里记录的是独立的外部真实宿主验收。

**本机真实闭环通过，范围仅为经备份后固定官方包与绝对Node24路径修正的当前连接。默认npx路径未通过，不能称已修复。** 初次Node22读页证据保留在`0132-host-read-proof.json`，不由最终成功覆盖。

## 证据与剩余步骤

原始生产错误、权限截图、重启进程回执、宿主UI截图及脱敏工具回执保存在本机`/tmp/agentwiki-workbuddy-acceptance-20261018/`。用户原始会话日志保留在WorkBuddy项目目录。最终宿主读页界面`0132-node24-final-read.png`（0600）显示工具调用成功、目标标题和updatedAt；主任务另核实doctor 10/10通过，作为真实MCP/进程证据的补充。私有正文、截图、凭据和完整授权URL不提交仓库。

本机要求的真实浏览器用户授权、客户端信任、两次完整重启及受支持Node24上的新会话MCP读页均已有证据。后续产品边界是默认WorkBuddy npx启动safe-delete与托管Node22兼容，以及未发布的指引修复d23bd089；不重复创建身份、发布0.13.2或部署0.12.48。是否发布新的产品修复需按新候选另行核验，不能把本机配置补正写成默认路径修复。
