# Generic MCP onboarding review — 2026-10-18

审查范围：当前隔离工作树中 `cli.ts`、`steps.ts`、`runtime.ts`、`browser.ts`、`node-runtime.ts`、`protocol.ts` 及相关用例；复核新增客户端进入服务端 DTO 与配置安装的路径。该记录不代表生产发布或真实 WorkBuddy 进程验收。

初轮发现并已修复、复测：

- Legacy coordinator 自动开浏览器缺少同源约束：现验证授权 URL 与目标服务同源且不含用户名密码，异常时不打开、不轮询。
- Legacy coordinator 恢复轮询时重复开浏览器：现先持久化浏览器尝试状态，成功和失败均不在 resume 时重复开窗。
- Runtime assembly 测试未隔离真实浏览器启动：现注入 mock opener。
- Legacy attach 绕过新增 Node 版本预检：现先检查 Node 24/26，再创建交互、换码或写配置。

上述修复后的 coordinator / attach / runtime / session 用例 147 项通过；CLI / steps 用例 57 项通过、1 项原有跳过；local-sync TypeScript 检查通过。前述缺陷复审通过。

源码复核结论：

- Gateway 不接受 `--protocol` 时显式抛出 unknown option；main 返回非零退出码并写 stderr。真实进程测试由主代理执行，避免并行构建互相清理 dist。
- `doctor --all-clients` 区分不存在的可选宿主配置（unverified）和已存在但缺少 MCP 项（fail）；注册检查明确不代表真实宿主工具调用成功。
- JSON start/continue 在 Node 不受支持时先阻断，并提供安装、验证 PATH 与重启客户端的可执行指引；status 保持只读。
- 浏览器启动通过 execFile 传单独 URL 参数，无 shell；仅允许 HTTPS 或 loopback HTTP。JSON flow 仅新授权或续期启动浏览器，status 不启动。
- Generic 输出明确为 manual-import；回执保留 hostVerification not_started / hostVerified false 及客户端导入、授权、重载或重启提示。

额外安装安全发现已关闭：JSON steps 现通过 connectionPreflight 在授权前、确认前和 bootstrap 前拒绝无关的同名 agentwiki 项；安装器也在同一份配置快照上检查归属，再检查确认 hash，覆盖所有调用入口。五种客户端的冲突回归测试先失败后通过，原配置逐字保留。冲突解决后用新的 requestId/planHash 重新确认；该恢复路径独立于 spaces 请求，在已保留 bootstrap/exchange 且 token 过期时也不会重复创建身份。

终审：installer / steps / browser 三套最新用例 59 项全部通过；上述同名冲突与恢复缺陷复审通过。既有 Agent 的安装指令已对当前候选版本选择 generic，对历史包保留 auto，且明确客户端授权、重启和真实宿主读页验证。此次审查范围内无未解决的阻塞缺陷。

发布边界：源码仍固定在当前候选 package version；新的客户端枚举与命令不得只部署网站/API 后直接指向不具备这些能力的旧 npm 包。实际发版必须统一更新并发布支持 generic/workbuddy 的新包版本及对应服务端和网页指令。本记录没有验证 npm 发布、生产环境或真实 WorkBuddy 的工具调用。
