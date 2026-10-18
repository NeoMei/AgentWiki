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
- 状态：源码修复与核心独立审查已完成，候选为 Local Sync 0.13.4 / Web/API 0.12.50。最终打包验证已通过：1121测试通过、1既有Windows跳过，固定179文件包和空缓存安装一致。尚未发布，待本轮新版本发布批准。

## 真实生成配置与客户端验收

先用修复后的安装器生成真实 WorkBuddy 配置，启动 npm 已发布的官方 0.13.3。生成器绑定绝对 Node24、官方 npm/npx 和随机私有系统临时缓存，没有固定已解压包的 dist 路径。原 0.13.2 配置已备份；原连接、reader 身份及空间授权均保留。

1. 首次完全退出、重开并新建会话后，工具清单没有 AgentWiki，缓存仍为空。该轮明确记为失败，未将配置文件存在算作成功。
2. 原生「专家·技能·连接器 → 连接器 → 自定义连接器」显示新命令需要信任。重新信任同一连接后，官方 npx 冷下载并启动成功，界面显示 agentwiki 绿色、34/34 工具已启用。该具体路径与启动命令变化后的信任要求已加入安装提示。
3. 再次完全退出，确认旧主进程退出，重开后新会话于 2026-10-18 18:51:10–15 UTC 真实调用 onboard_status、wiki_list_spaces、wiki_get_page。日志与原生 UI 均返回成功：当前 gateway connected、无需再次重载；空间为 reader；目标页标题和 updatedAt 与预期一致，正文 8156 UTF-8 字节，SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b` 完全匹配。
4. 本次缓存内官方 manifest 为0.13.3、registry lock 指向官方 npm；启动及新会话 npm 日志确认 Node24.18.0 / npm11.16.0。目录属当前用户、0700、非符号链接。采样时临时网关已不活跃，未声称捕获完整实时进程链。

这一结果证明新的 npx 启动配置在真实 WorkBuddy 可用；0.13.4 还未发布，不能将它描述成0.13.4正式包验收。浏览器账号授权沿用此前已实际完成的授权，没有重新创建身份或声称本轮重新走过授权。历史安装检查点的 failed_terminal 不等同于本次实时网关状态。Windows 原生宿主尚未实测。

私有独立回执：`/tmp/agentwiki-npx-fix-20261019/workbuddy-generated-0133-trusted-restart-evidence.json`。首次未信任的失败回执另存，不覆盖。

私有原始脱敏证据：`/tmp/agentwiki-npx-fix-20261019/native-cache-experiment.json`。原始日志、页面正文、配置备份和截图不提交仓库。
