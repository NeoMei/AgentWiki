# WorkBuddy 默认 npx 缓存锁修复

本轮由用户要求解决默认 `npx` 缓存删除拦截而启动。此前 0.13.3 发布成功和固定 0.13.2/Node24 的真实读页，不作为此缺陷已修复的证据。

## 根因与真实对照

WorkBuddy Bash 中的 Node24.18.0 / npm11.16.0 运行官方 0.13.3 `--help`，在 npm 自身的 `libnpmexec/with-lock.js` 释放 `_npx/<hash>/concurrency.lock` 时，被 WorkBuddy 内置 `node-safe-delete-shim.cjs` 拒绝；AgentWiki CLI 还没有执行。任意任务目录缓存也不是可用解法。

WorkBuddy 内置规则允许真实系统临时目录下的正常临时文件删除。保持全部安全环境，使用 `fs.mkdtempSync(os.tmpdir())` 创建的私有缓存，官方 npx 的冷启动和热启动均返回 CLI 帮助及退出码 0。同一 Bash 调用中的 Node 探针确认 language/safe-delete 两个 shim 都已加载。探针不冒充 npx 进程内部探针；热启动仍经过 npm 并发锁代码。没有删除旧缓存或取消安全保护。

最初通过原生输入框粘贴包名时，WorkBuddy 的 mention 处理改写了 scoped spec；其 ENOENT 已作为无效试验单列。后续有效命令精确生成官方 scoped spec，并以实际工具日志和 npm debug 栈核对。

## 修复与验收状态

- 网页及公开 API 指令：WorkBuddy 首次 npx 前选择支持的运行时并创建系统临时私有缓存，后续命令复用精确版本与缓存，保留同一 session。
- WorkBuddy 配置生成：绑定支持的 Node 与官方 npm/npx，使用专属临时缓存；每次启动检查缓存身份/权限，缺失时私有重建。
- 安装验证：执行真实写入的 command/args/env；其他客户端行为不变。
- 当前状态：Local Sync 0.13.4 / Web/API 0.12.50 已正式发布。最终候选 1121 测试通过、1 既有 Windows skip；固定包与正式 npm 包的 179 文件、空缓存安装一致，独立审查无开放问题。正式执行与宿主验收见下文，发布前阶段快照保持原样。

## 历史对照：发布前使用官方 0.13.3 的生成配置验收

先用修复后的安装器生成真实 WorkBuddy 配置，启动 npm 已发布的官方 0.13.3。生成器绑定绝对 Node24、官方 npm/npx 和随机私有系统临时缓存，没有固定已解压包的 dist 路径。原 0.13.2 配置已备份；原连接、reader 身份及空间授权均保留。

1. 首次完全退出、重开并新建会话后，工具清单没有 AgentWiki，缓存仍为空。该轮明确记为失败，未将配置文件存在算作成功。
2. 原生「专家·技能·连接器 → 连接器 → 自定义连接器」显示新命令需要信任。重新信任同一连接后，官方 npx 冷下载并启动成功，界面显示 agentwiki 绿色、34/34 工具已启用。该具体路径与启动命令变化后的信任要求已加入安装提示。
3. 再次完全退出，确认旧主进程退出，重开后新会话于 2026-10-18 18:51:10–15 UTC 真实调用 onboard_status、wiki_list_spaces、wiki_get_page。日志与原生 UI 均返回成功：当前 gateway connected、无需再次重载；空间为 reader；目标页标题和 updatedAt 与预期一致，正文 8156 UTF-8 字节，SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b` 完全匹配。
4. 本次缓存内官方 manifest 为0.13.3、registry lock 指向官方 npm；启动及新会话 npm 日志确认 Node24.18.0 / npm11.16.0。目录属当前用户、0700、非符号链接。采样时临时网关已不活跃，未声称捕获完整实时进程链。

这一阶段证明新的 npx 启动配置在真实 WorkBuddy 可用；当时 0.13.4 尚未发布，此结果不能描述为 0.13.4 正式包验收。浏览器账号授权沿用此前已实际完成的授权，没有重新创建身份或声称本轮重新走过授权。历史安装检查点的 failed_terminal 不等同于本次实时网关状态。Windows 原生宿主尚未实测。

私有独立回执：`/tmp/agentwiki-npx-fix-20261019/workbuddy-generated-0133-trusted-restart-evidence.json`。首次未信任的失败回执另存，不覆盖。

私有原始脱敏证据：`/tmp/agentwiki-npx-fix-20261019/native-cache-experiment.json`。原始日志、页面正文、配置备份和截图不提交仓库。

## 正式发布与真实 WorkBuddy 0.13.4 验收

用户明确批准发布后，Local Sync 0.13.4 与 Web/API 0.12.50 从冻结提交 `99b247c7e21a3322398c7c8a2e7bda4995151e03` 正式发布。npm 官方 version/latest 均为 0.13.4；正式 tarball SHA256 `d8dc68a986ff9716055a1731a8ee48aabdbff6ce31525f50aaca38e019b3dde0` 与冻结包一致，179 文件逐项匹配，空缓存安装通过。

生产部署前完成数据库、应用、配置和附件的协调备份 `/var/backups/agentwiki/generic-mcp-v01250.koa2dsst`，校验和、154 个 blob 与 writers 恢复均通过。冻结导出部署 exit0；1360 个源文件匹配，3 个服务 active、5 项健康正常，公网 HTML 与 5 个入口资源匹配。旧应用保留在 `/root/agentwiki-previous-20261019031732`。备份未做恢复演练。

正式 0.13.4 安装器在备份后更新 WorkBuddy 单一 MCP 配置，新配置 SHA256 `7a7a6b6eea4d5f3754e7c572cae6f069f02b1e1485e2bb30d0e825b7acbe1180`。原 connection、reader 身份和 Space 授权保留；配置采用绝对 Node24、官方 npm/npx、固定 0.13.4 与随机私有系统临时缓存，没有改用解压 dist 路径。

1. 确认旧 WorkBuddy 主进程 71909 退出，重新启动进程 87933；重新信任变更后的命令，官方 npx 冷启动成功，原生界面显示绿色连接和 34/34 工具启用。
2. 完全退出进程 87933 并重开，在新会话 `9bedded8-9cae-4585-9b8d-20f911996854` 于 2026-10-18 19:19:23–30 UTC 真实调用 onboard_status、wiki_list_spaces、wiki_get_page。日志独立提取确认三项 completed，只有工具发现及指定 MCP 派发，没有终端或 API 替代。
3. 实时网关为 connected / REMOTE_CONNECTED，28 个远端工具已注册，无需重载；目标空间角色 reader。目标页 8156 UTF-8 字节，SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b` 与预期一致。历史检查点 failed_terminal 仍保留，不能混同为实时网关失败。
4. 客户端 cache 为当前用户所有、0700、非符号链接；下载的官方 0.13.4 包与候选 179 文件全部匹配。冷启动与重启的 npm 日志确认 Node24.18.0 / npm11.16.0，未发现本次缓存锁删除拒绝。读取时仍运行的日志没有 exit 行，不将缺失 exit 行写成 exit0；实际采样捕获完整父子链：WorkBuddy 主进程 89235 → 89300 → 89615 → npm exec 89903 → gateway Node 89955。该 MCP 进程的 NODE_OPTIONS 存在，但未引用 language/safe-delete 两个 shim，不能据此宣称 MCP 层加载了它们；WorkBuddy Bash 的安全环境验收另记。

正式包另在真实 WorkBuddy Bash 完成冷/热验收：2026-10-18 19:22:48 UTC 发起，约 19:23:54 UTC 返回。同次 Bash 的前置 Node `require.cache` 探针报告 `safeDeleteShimLoaded=true`、`languageShimLoaded=true`，运行时 Node24.18.0/npm11.16.0；未修改 NODE_OPTIONS。使用 `os.tmpdir()` 下全新 0700 私有缓存，调用同安装的官方 npx-cli、固定 0.13.4 `--help`，冷/热两次均 exit0，debug 无 safe-delete 错误，未删除旧缓存。探针只证明该前置 Node 进程加载了两个 shim，不冒充 npx 内部注入观测；与 MCP 读页的证据范围分开，回执见 [native-cache-0134.json](native-cache-0134.json)。

Chrome 已实际刷新线上指南、选择 WorkBuddy 并展开指令；公开 `/api/onboard` 返回 200。固定 0.13.4、首次 npx 前的运行时/私有缓存准备、原会话继续、客户端权限与重启提示均核对通过。本轮未重新发起账号授权，沿用此前 0.13.2 真实授权；未创建新身份或扩大权限。Windows 原生宿主未实测。

私有正式回执在 `/tmp/agentwiki-release-0134-plan/`：`registry-verified.json`、`backup-receipt.json`、`production-host-verified.json`、`production-public-verified.json`、`guide-verification.json`、`workbuddy-generated-config-0134.json` 及 `workbuddy-0134-real-mcp-final-evidence.json`。原始日志、正文、配置备份和截图保持私有；候选与先行 0.13.3 历史回执不覆盖，正式发布和 0.13.4 宿主结果分别见 [release.json](release.json) 与 [real-workbuddy-0134.json](real-workbuddy-0134.json)。
