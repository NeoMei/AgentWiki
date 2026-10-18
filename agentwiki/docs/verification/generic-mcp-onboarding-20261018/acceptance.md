# 通用 MCP 与 WorkBuddy 接入反馈修复

日期：2026-10-18（Asia/Shanghai）。基线：origin/master 9851195ecdbdcb9d2fbcddb74bdd950b3d4454a5。隔离分支：codex/generic-mcp-onboarding。

## 逐项结果

| 用户反馈 | 原因与修复 | 验证及边界 |
| --- | --- | --- |
| 只有三种 Agent | 客户端枚举、安装器、服务端 DTO 和两类生成指令均有限制。网页及CLI默认 generic；支持所有能运行本地 stdio MCP 的宿主，导出 ~/.config/agentwiki/mcp.json。WorkBuddy快捷适配写 ~/.workbuddy/mcp.json。 | 五客户端安装/备份/恢复/卸载/冲突测试，真实网页复制入口；generic导出不是宿主已经载入。未知宿主由Agent按实际MCP格式导入，不能猜写Codex配置。 |
| 手动拷贝授权 URL | 启动与续授权通过 macOS open / Windows rundll32 / Linux xdg-open 自动打开，不经shell，验证同源与安全协议，失败保留URL。status只读、恢复不反复开窗。 | macOS真实系统open+Chrome新标签页确认；三个平台命令边界单元测试，Windows/Linux实际桌面待验。网页打开不代表授权批准。 |
| 客户端授权/重启缺提示 | JSON/NDJSON回执、网页和生成指令明确导入/启用MCP、允许工具、重载/完全退出重启、新对话、读取已知页面。 | 中英文/390px及只读approved fixture验收；未改真实WorkBuddy配置，也未重启客户端或做真实宿主读页。 |
| doctor只检查单客户端 | 新增 --all-clients 检查4个已知宿主配置；未安装可选宿主为unverified，有配置但缺MCP为fail；generic注册始终unverified。 | CLI真实配置fixture测试；配置存在仍不证明实际宿主连通。 |
| Node检查过晚 | start/continue、旧NDJSON及安装码attach在状态写入、浏览器授权和远端换码前检查Node24/26，返回可执行安装/PATH/重启说明。 | Node22注入回归，以及真实CLI子进程模拟process.version=v22.22.2：exit1、NODE_UNSUPPORTED、指导可见、临时HOME无写入。未运行真实Node22二进制、未改用户Node。 |
| gateway不支持参数只打印Usage | 子命令允许参数显式校验，gateway --protocol json输出Unknown option并exit1。JSON错误保留脱敏message。 | 真实CLI子进程stdout/stderr/exit-code检查。 |
| --help缺失 | 顶层和子命令支持--help/-h，分别列参数、示例、reply-file输入/确认JSON结构。 | CLI+子进程测试；运行时契约改为执行真实--help，避免依赖源码字符串样式。 |

## 复核额外修复

旧入口也执行Node预检、浏览器同源校验和resume去重。任意客户端中无关同名agentwiki服务在preflight和安装写入前均阻断并逐字保留。用户解决冲突后，同一session生成新requestId/planHash重确认，不重复创建Agent/Space。旧版本生成指令保留auto，当前源码候选使用generic。详细独立审查见review.md。

## 最终验证

- Local Sync全套：74 files，1071 passed / 1既有Windows skip；`vitest run --maxWorkers=2 --testTimeout=20000` exit0。包括真实有限进程重试、授权、配置与网关检查。
- 服务端接入/安装/DTO：9 suites，271 passed / 3既有skip，exit0。
- 前端相关7 files：82 passed，exit0。
- Node/runtime contract：33 passed，含真实打包与CLI帮助，exit0。
- Local Sync编译、Server typecheck、Client tsc+生产构建、修改生产文件ESLint、git diff --check通过。前端仍有既有Mermaid circular-chunk及large-chunk warnings，bundle budget通过。
- 实际浏览器：中英文、generic/WorkBuddy切换、复制UI反馈、CSS390无横溢出、授权后提示及macOS自动打开；详情browser-qa.md和browser-opener.json。
- 常规并行整包曾有未修改的source-lock竞争测试超时；单独29项通过，最终限制2 workers的完整1071项通过。没有修改该锁逻辑或测试、没有隐藏失败。

## 发布与原环境边界

本轮未push、未发布npm、未部署生产、未修改用户真实MCP配置。版本常量保持基线0.13.1，**已经发布的0.13.1不包含本轮能力**。正式发布必须提升Local Sync新版本，同步Web/API版本、服务端允许范围及精确版本命令，并执行新包/生产门禁；不能只部署当前网站/API而让它生成指向旧0.13.1的generic/workbuddy命令。历史版本仅保留其原有支持选项。

没有把本地网关检查、mock授权页或系统打开成功当成用户原WorkBuddy接入成功。原环境仍需新版本安装、用户批准客户端权限、重载/重启后在WorkBuddy调用wiki_*读取已知页面。

WorkBuddy配置路径参考其官方文档：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide 。
