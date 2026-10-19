# 0.12.48 / 0.13.2 发布候选准备

准备时间：2026-10-19 00:01（Asia/Shanghai）。来源为 `6fffd762` 上的版本同步变更，已独立审查并固化为 `0a299231`；待用户确认发布。本记录只证明版本、构建和本地包门禁，不证明真实宿主授权或读页。

## 版本与范围

| 项目 | 基线 | 候选 |
| --- | --- | --- |
| root / server / client | 0.12.47 | 0.12.48 |
| Local Sync | 0.13.1 | 0.13.2 |
| sync protocol | 0.6.1 | 0.6.1，不变 |

同步运行时标识、接入请求/计划/会话 schema、网关安装命令、随包 skill、服务端版本接受范围、Web 固定命令与对应 fixture。服务端保留 0.13.1 和此前版本，原请求版本与 planHash 不重写。旧版生成原版 `--agent auto` 指令；0.13.2 使用 generic/WorkBuddy 新入口。旧本地会话继续用其原有精确版本命令。

没有依赖或数据库结构变化。pnpm lockfile 中 `0.13.1` 均属于无关的 `emittery` 依赖，未替换；workspace 自身版本不写进该 lockfile。

官方 npm 元数据返回 latest 0.13.1；显式 registry 碰撞门禁确认 0.13.2 尚未占用。Protocol 0.6.1 打包内容与官方已发布内容一致，无需重新发布。

## 已运行门禁

| 门禁 | 结果 |
| --- | --- |
| runtime/版本契约与 registry gate 单测 | 46 通过 |
| server 版本接受、bootstrap、安装/旧版指令及 guide | 5 文件、195 通过 |
| client 版本与提示词组件 | 5 文件、38 通过 |
| Local Sync `npm pack` prepack | 74 文件、1071 通过、1 个原 Windows 用例跳过 |
| Local Sync / server / client 构建 | 通过 |
| protocol 与官方 npm 0.6.1 内容一致性 | 通过 |
| 空安装目录/空缓存 + 候选 Local Sync tarball + 官方 protocol | 通过；两条 publisher 路径、16 scopes、plan/tamper 拒绝契约 |
| `git diff --check` | 通过 |

门禁的服务器/身份持久化边界使用隔离适配器；它是包兼容验证，不是生产连接或 WorkBuddy 验收。真实流程单独由主任务记录。

可审阅 tarball：`/tmp/agentwiki-0132-release-candidate/neomei-agentwiki-local-sync-0.13.2.tgz`，175 文件，199526 bytes。

SHA-256：`836a92c65c9fae6ba3fbc181a6b861cbd4380517764291115b6ce45bc86556b9`。

详细机器记录、完整性和本地日志路径见 [release-candidate.json](release-candidate.json)。

## 发布内容与顺序

1. 主任务审查并固化候选 commit，重核候选 npm 版本未占用；如果修改了包内容，重新打包并更新摘要。
2. 按项目部署约定准备并核验协调数据库/附件备份及部署清单。
3. 发布唯一新 npm 包 `@neomei/agentwiki-local-sync@0.13.2`；不重发 protocol。正式下载包须与已审候选逐文件一致，再用全新目录和缓存从官方 registry 安装验证。
4. 同步部署 Web/API 0.12.48，并将生产 `LOCAL_SYNC_PACKAGE_VERSION` 设置为 0.13.2。服务端须包含 WorkBuddy/generic 的 clientType 和 0.13.2 接受范围；Web/API 指令须固定同版本。
5. 检查生产健康、实际网页指令、device/start 与所生成配置，再由真实 WorkBuddy 完成浏览器授权、客户端 MCP 权限、重启及新会话 MCP 读页。

此子任务没有发布、推送、部署、调用生产或更改用户配置。上述发布动作尚未执行，真实 WorkBuddy 验收也不计入这些本地门禁。
