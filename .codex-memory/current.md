# 当前目标

用户明确要求解决 WorkBuddy 默认 npx 缓存删除拦截，并已批准发布。Local Sync 0.13.4 与 Web/API 0.12.50 已正式发布；真实 WorkBuddy 使用正式 0.13.4 的新生成 npx 配置，经重新信任、冷启动和再次完整重启后，MCP 诊断、reader 空间查询与目标页读取均通过。

# 范围 / 不做

- Web/API/client/root 0.12.50、Local Sync 0.13.4；protocol 0.6.1、依赖、lockfile 与数据库结构不变。
- 首次接入指令和 WorkBuddy MCP 配置使用真实系统临时目录下的私有 npm 缓存，绑定受支持的 Node 与官方 npm/npx；保留 WorkBuddy 安全保护。
- 原 WorkBuddy 配置已备份，当前配置由正式 0.13.4 安装器生成；保留原 connection、reader 身份和 Space 授权。当前 Codex、原检出修改与日常 Vault 不在修改范围。
- 本轮浏览器重验线上指南与公开 API，未重新发起账号授权；Windows 原生宿主未实测，备份未做恢复演练。

# 当前状态

- 发布源码冻结为 `99b247c7e21a3322398c7c8a2e7bda4995151e03`。最终 prepack 75 文件、1121 通过、1 既有 Windows skip；类型、lint、构建、协议 parity 与独立审查通过，无开放问题。
- npm 官方 version/latest 均为 0.13.4；正式 tarball SHA256 `d8dc68a986ff9716055a1731a8ee48aabdbff6ce31525f50aaca38e019b3dde0` 与冻结包一致。179 文件逐项匹配，空目录/空缓存安装通过。
- 协调备份 `/var/backups/agentwiki/generic-mcp-v01250.koa2dsst` 已核验校验和、154 个附件 blob 与配套数据库/应用/配置；writers 已恢复。冻结导出部署 exit0，生产 1360 个源码文件一致，3 服务 active、5 项健康通过；公网 HTML 与 5 个入口资源匹配。
- Chrome 线上 WorkBuddy 指南和公开 `/api/onboard` 已核对 0.13.4、首次 npx 前的缓存准备、运行时选择、原会话继续、权限与重启提示；不是新账号授权验收。
- 真实 WorkBuddy 新配置 SHA256 `7a7a6b6eea4d5f3754e7c572cae6f069f02b1e1485e2bb30d0e825b7acbe1180`；旧进程退出后冷启动并重新信任，34/34 工具启用，再次完全退出、重开新会话 `9bedded8-9cae-4585-9b8d-20f911996854`。2026-10-18 19:19:23–30 UTC 三次真实 MCP 调用成功，reader 目标页 8156 UTF-8 字节，SHA256 `34e06f9db48b768de26609aa4962c5ec168fd206f670a32a036c44b17032436b` 一致。客户端缓存内正式包 179 文件匹配，npm 日志确认 Node24.18.0 / npm11.16.0；新主进程到 npm exec 再到 gateway 的实际进程链已捕获。

# 稳定约束

- Git 在带尾空格仓库根显式使用 `--work-tree="$PWD"`；发布源码始终为冻结提交，后续文档不改变发布包。
- 接入会话持久化精确包版本；旧会话用原精确版本继续，不修改 marker/version/planHash，不为升级重建身份。
- 正式包回读、生产部署/健康、浏览器渲染、真实宿主调用分别记证；模拟测试、curl、SDK 或旧版本读页不能代替新正式包宿主验收。
- 账号授权、客户端信任与完整重启分别记证。历史检查点 failed_terminal 不代表当前网关状态；本轮实时网关为 connected。
- 不提交私有截图、正文、凭据、原始完整日志与备份。不自动恢复覆盖快照后的用户写入。

# 关键索引

- `.codex-memory/tasks/archive/generic-mcp-onboarding-20261018/{brief,decisions,refs}.md`
- `agentwiki/docs/releases-v0.12.50.md`
- `agentwiki/docs/verification/workbuddy-npx-20261019/acceptance.md`：历史对照与本轮正式验收。
- 同目录 `release.json`、`real-workbuddy-0134.json`：本轮正式发布与宿主验收；`release-candidate.json`、`review.json`、`real-workbuddy.json` 保留历史准备快照。
- `/tmp/agentwiki-release-0134-plan/`：正式包、备份、部署、线上指南、客户端配置和真实 MCP 的私有原始回执。
- `/tmp/agentwiki-0134-release-candidate/`：固定 tarball 与最终候选门禁。

# 风险 / 下一步

1. 发布与本机正式包 npx/权限/重启/MCP 读页验收已通过。真实 WorkBuddy Bash 另验正式 0.13.4：同次 Bash 的前置 Node 探针确认两项安全 shim 已加载，保持 NODE_OPTIONS；全新系统临时 0700 缓存内官方 npx 冷/热启动均 exit0，无删除拦截。该探针不是 npx 进程内部注入证明；回执见 `native-cache-0134.json`。
2. 浏览器账号授权沿用 0.13.2 的真实证据，本轮未重跑全新身份授权；Windows 原生与备份恢复演练仍是未验证边界。
3. 启动命令变化后需在「专家·技能·连接器 → 连接器 → 自定义连接器」重新信任；首次未信任失败保留为历史，不覆盖。
