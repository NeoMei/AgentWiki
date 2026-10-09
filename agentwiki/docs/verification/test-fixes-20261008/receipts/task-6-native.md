# Task 6 隔离 macOS Obsidian 原生验收

日期：2026-10-08。结论：**合成 fixture 的真实手动连接、映射自动建嵌套目录、首次自动合并、原生文件回读通过；原测试者报告仍待验。** 本文不代表 Windows 验收、生产接入、日常 Vault 验收、插件发布或安装到日常 Vault。

## 候选与环境

- 插件候选：`/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/test-fixes-20261008`；Task 6 回执及独审身份 `e5b8a3a2624b5208d16a656d15ccd194d2805fd7`，manifest 0.5.6。本次未改产品源码或 Git。
- 复制前确认新 Vault 不存在，创建 `/Users/Shared/agentwiki-test-20261008/obsidian-vault`；只复制候选 `main.js`、`manifest.json`、`styles.css` 到该 Vault。
- 安装及结束时 `main.js` 均为 1,747,198 bytes，SHA-256 `5d170a372a574bd8c63abcbd6d56ca7ce17f2aef4d0be45eee4748174c1365a6`。
- 原生 Obsidian 1.14.4，macOS；实际加载的插件 manifest 为 0.5.6。CLI 身份回读确认 `app.vault.adapter.getBasePath()` 精确为上述 fixture。
- 本地服务 `http://127.0.0.1:3191/api`，新建合成账号、空间、父目录、子目录和页面。没有真实 provider；没有访问生产；没有安装到已有 Vault。
- 真实 UI 显示本次协议为 **Sync v2**。此原生用例不外推为 Sync v3 实测。

## 操作与证据分层

1. 通过原生仓库管理器“打开本地仓库”，选中上述新目录，加载已审查候选插件。
2. 在真实插件设置页填入 `http://127.0.0.1:3191`。合成安装码通过设置窗口 DevTools 从 mode 0600 的私密 fixture 文件读取，写入实际输入框并触发 input 事件；仅把该输入框临时设为 password 隐藏显示。没有打印码或令牌，没有直接调用 plugin.connect 代替按钮。
3. **真实 CUA 点击“连接”**，UI 回读“已连接”“连接成功”。本地 API 为真实 installation → exchange → session → activate 流程。
4. **真实下拉选择合成空间，填入 `隔离验收/自动创建/映射根`，点击“添加”**。UI 回读“本地文件夹已就绪，映射已添加”及“待首次拉取”；磁盘独立检查三个原不存在的目录均已自动创建。
5. **真实点击 AgentWiki Sync ribbon → 自动合并（推荐）**。原生预览按顺序显示：`创建目录: pages/远端父目录`、`创建目录: pages/远端父目录/远端子目录`、`创建: pages/远端父目录/远端子目录/首次同步验收.md`。未出现 UNKNOWN_PARENT。
6. **真实点击“确认执行”**。磁盘页面内容与服务端创建的合成正文逐字一致；映射已变为 `active`。真实点击文件树页面条目后，原生编辑器显示 `AGENTWIKI_NATIVE_FIRST_PULL_20261008` 与合成正文。
7. **真实再次点击 ribbon**，UI 回读“本地与服务器已同步，无需操作”“本地没有未推送的变更”“服务器没有新的变更”。

CLI / renderer 仅用于身份与持久化状态读回、私密输入码注入及截图；连接、添加、打开同步面板、自动合并、确认执行和打开页面均有真实原生按钮/条目操作。合成数据通过 API 创建，不宣称网页创建流程已验。

## 实际文件与证据

- 合成空间：`cmuzj0rd10053ig68ci4ioy5w`；父目录 `cmuzj0rdj0059ig68nj1nfnh1`；子目录 `cmuzj0ree005fig6835qyloyb`；页面 `a791b737-dde9-441e-a67a-c36dbcf67c3b`。
- 实际页面：`/Users/Shared/agentwiki-test-20261008/obsidian-vault/隔离验收/自动创建/映射根/pages/远端父目录/远端子目录/首次同步验收.md`。
- 页面 SHA-256：`3b311a6541bbff6114919a59b03ea2ba093ba872364d0ec0c386b18b4cb4d215`；`contentMatches=true`。
- `/tmp/agentwiki-1008-ui/obsidian-native-first-pull.png`：原生文件树与编辑器回读；截图通过当前 fixture 窗口 webContents.capturePage 保存，已实际查看。
- `/tmp/agentwiki-1008-ui/obsidian-native-sync-clean.png`：原生同步完成状态；恢复后使用 `obsidian vault=obsidian-vault dev:screenshot` 保存。
- `/tmp/agentwiki-1008-ui/obsidian-native-result.json`：脱敏检查结果。
- `/tmp/agentwiki-1008-ui/obsidian-cli-recovery.txt`：恢复后 CLI 的 fixture 身份、manifest 与 active 映射回读。
- `/tmp/agentwiki-1008-ui/obsidian-sync-clean-dom.txt`：同步完成 DOM 文本。
- 合成凭据没有进入报告、截图或 Git。连接过程使用插件原生密钥存储；证据取得后已用合成用户 API 撤销唯一设备凭据，并通过候选插件 disconnect() 清空本地凭据。此清理调用不是按钮验收证据。剩余合成登录材料只在 mode 0600 的 `/tmp` 私密 fixture 文件，不能作为公开证据提交。

## 本次验收引入的 CLI 环境影响及修复

此项不是产品缺陷，也不是无关的既有环境限制；由本次尝试启动隔离 Obsidian 实例引入，已恢复。

- 开始时 `obsidian help`、`obsidian vaults verbose` 成功。尝试 `open -na Obsidian --args --user-data-dir=/tmp/agentwiki-1008-obsidian-profile` 创建 PID 47402；该新进程最终只由本次验收终止，没有重启日常 Obsidian PID 70675。
- 第二实例存活时 CLI 返回 `Command line interface is not enabled. Please turn it on in Settings > General > Advanced.`；终止它之后返回 `The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again.`。此时 `~/.obsidian-cli.sock` 文件不存在。
- 在 fixture 设置中对既有 CLI 开关进行关闭/恢复启用，不能重建 socket。未注册新的 PATH 安装、未重启或关闭日常窗口。
- 只读核对安装的 Obsidian 1.14.4 asar：所有实例用同一 home 下 `.obsidian-cli.sock`，启动监听前和 will-quit 时调用 unlink；这解释了第二实例删除共享 socket 路径。原进程已有 net.Server 仍 `listening=true`，地址仍是原 socket。
- 通过 fixture DevTools，过滤主进程唯一 `address() === '/Users/neomei/.obsidian-cli.sock'` 的既有监听器，并确认该路径确实不存在后，只对该对象执行 `close` → `listen` 原地址。没有创建替代实现、修改 Obsidian bundle 或新开第二实例。
- 修复后 `obsidian vaults verbose`、`vault=obsidian-vault eval` 和 `dev:screenshot` 均 exit 0；这同时确认 CLI 已恢复既有 enabled 状态。原窗口进程仍为 PID 70675。

## 未通过或未覆盖的边界

- 原测试者的 bundle/协议/baseline/错误栈和原始树仍未知；本次新合成空间的首次配对成功不能关闭原报告。
- Task 6 实际修复的“已有 baseline 父目录本地删除、远端保留且新增后代”边界，本次不另做原生 GUI 冲突选择；其证据仍以 Task 6 回归与独审为准。
- 最初 CUA 按应用名选窗意外返回日常 Vault 窗口 AX 内容；没有进一步操作该正文或把它复制到测试数据/证据。随后通过仓库管理器打开 fixture，并以路径、标题和 CLI 身份检查约束后续操作。不能把此次过程描述为从未收到日常窗口内容。
- API fixture 首次构造遗漏根目录 `parentId:null`，服务端正确返回 400；修正请求后新建完整 fixture 成功。失败创建留下的空合成账号/空间属于该本地测试后端，不是插件错误。
- 尚需控制器依整体验收流程清理本地测试服务数据；本次不停止控制器运行的 3191 服务。

## 收尾

- 自建第二 profile 进程已终止；新 Vault、实际同步文件与脱敏证据保留以便复查。
- 同步证据保存后撤销 1 个合成远端设备凭据，插件本地断开；回读 `localDisconnected=true`、`mappingsRetained=1`。这是测试结束清理，最终 Vault 保留文件与映射，重新连接需要新合成连接码。
- 已用 CUA 点击本次唯一 fixture 主窗口的关闭按钮；后续只读取返回窗口标题，确认前台回到既有日常 Vault，未关闭日常窗口。关闭后原 Obsidian PID 70675 仍运行，`obsidian vaults verbose` 再次 exit 0。控制器 3191 服务未被停止。
