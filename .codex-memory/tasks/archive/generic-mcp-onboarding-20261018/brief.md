# 通用 MCP 接入与 WorkBuddy 反馈修复

目标：修复三客户端限制、授权链接衔接、客户端权限/重启提示、Node 预检、doctor 范围、CLI 帮助和默认 npx 缓存删除拦截，以真实 WorkBuddy 验收。

当前：用户已明确批准发布冻结候选 `99b247c7e21a3322398c7c8a2e7bda4995151e03`。Local Sync 0.13.4、Web/API 0.12.50 已正式发布，protocol 保持 0.6.1。默认缓存锁问题通过首次接入指令及 MCP 启动配置的私有系统临时缓存修复，绑定受支持 Node 和官方 npm/npx，未关闭安全保护。

npm 官方 version/latest 均为 0.13.4；正式 tarball SHA256 `d8dc68a986ff9716055a1731a8ee48aabdbff6ce31525f50aaca38e019b3dde0` 与冻结包一致，179 文件与空缓存安装通过。候选最终 1121 测试通过、1 既有 Windows skip，类型/lint/构建/协议 parity 和独立审查通过。生产协调备份 `/var/backups/agentwiki/generic-mcp-v01250.koa2dsst` 已核验并恢复 writers；冻结导出部署 exit0，1360 源文件一致、3 服务 active、5 项健康通过，公网 HTML 与 5 入口资源匹配。

真实客户端验收：正式 0.13.4 安装器备份后更新 WorkBuddy 单一 MCP 配置，保留原 connection、reader 身份及 Space 授权。旧进程退出后，重新信任新命令，官方 npx 冷下载成功，34/34 工具启用；再次完整退出并重开后，新会话 `9bedded8-9cae-4585-9b8d-20f911996854` 于 2026-10-18 19:19:23–30 UTC 真实调用 onboard_status、wiki_list_spaces、wiki_get_page。当前网关 connected、无需重载，空间为 reader；目标页 8156 UTF-8 字节，SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b` 一致。独立日志提取确认只有工具发现与指定 MCP 派发，无终端/API 替代；客户端缓存内正式包 179 文件一致，npm 日志确认 Node24.18.0 / npm11.16.0。

浏览器重验范围为 Chrome 线上指南和公开 API：0.13.4、第一次 npx 前的运行时/私有缓存准备、同会话继续、客户端权限和重启提示均已核对。账号授权沿用此前 0.13.2 的真实用户授权，本轮未新建身份或重跑全新授权。Windows 原生宿主与备份恢复演练未执行；实际捕获新 WorkBuddy 主进程至 npm exec、gateway 的进程链；MCP 进程 NODE_OPTIONS 未引用 language/safe-delete 两个 shim，不能据此宣称加载了它们。真实 WorkBuddy Bash 于 19:22:48 UTC 另发正式 0.13.4 冷/热验收，约 19:23:54 UTC 返回：同次 Bash 的前置 Node 探针确认 language/safe-delete 两个 shim 已加载，保持 NODE_OPTIONS，Node24.18.0/npm11.16.0；全新系统临时 0700 缓存内官方 npx 冷/热启动均 exit0，无删除拦截。探针不代表 npx 进程内部观测；独立回执见 `native-cache-0134.json`。

历史证据独立保留：0.13.2 的真实授权/固定 Node24 读页；0.13.3/0.12.49 的发布与旧连接兼容；本轮修复前的默认 npx 拒绝、0.13.3 新生成配置首次未信任失败及随后成功。早期将 wiki.test 模拟开窗误称真实 Chrome 验收的结论已撤回，原纠正记录不覆盖。

当前说明见 `agentwiki/docs/verification/workbuddy-npx-20261019/acceptance.md` 与 `agentwiki/docs/releases-v0.12.50.md`。同目录候选、审查和先行 0.13.3 回执保留阶段快照，正式 0.13.4 发布与宿主验收见同目录 `release.json`、`real-workbuddy-0134.json`；完整私有执行证据在 `/tmp/agentwiki-release-0134-plan/`。
