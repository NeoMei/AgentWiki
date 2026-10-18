# 当前目标

执行用户明确要求的发布：指引修正及跨版本会话推进保护已冻结为 `1e3fb140`，Local Sync 0.13.3 正式 npm 包及 Web/API 0.12.49 生产部署已验证通过。真实 Chrome 与公开 API 指南验证通过；既有 WorkBuddy 0.13.2 固定 Node24 连接部署后真实 MCP 读页通过，本轮发布收口完成。

# 范围 / 不做

- Web/API/client/root 0.12.49、Local Sync 0.13.3；protocol 0.6.1、依赖、lockfile 与数据库结构不变。
- 本轮修复授权轮询、真实 MCP 诊断指引及跨版本误续进；默认 WorkBuddy npx/safe-delete 和托管 Node22 兼容仍未修复。
- 保留 WorkBuddy 已验证的官方 0.13.2 + 绝对 Node24/CLI 配置、当前 Codex 0.13.0、既有身份和 Space 授权、原检出修改及日常 Vault。旧 0.13.2 回执不覆盖。
- 不索取或输出认证材料；数据库恢复不自动执行，须单独评估快照后用户写入。

# 当前状态

- 候选冻结 `1e3fb14001ec33f1c77be1dbfe86f9b02406d382`；独立审查无阻塞。最终 prepack 74 文件/1085 通过/1 Windows 专属 skip；版本契约 46、服务端兼容 202、公开指南 3、网页 47 通过，构建/lint/diff 与官方 protocol parity 通过。
- npm publish 已认证成功、exit0；metadata 先开放而 tarball 短暂 404 后，官方 version/latest 均 0.13.3，正式包 SHA256 `032773b2da2ddd8e53d1dd1aefe42922dfe0d9d58f0a9d803a0ea0ab333acdf3` 与冻结包一致。175 文件匹配、空目录/空缓存安装 0.13.3 + protocol 0.6.1 通过。
- 新协调备份 `/var/backups/agentwiki/generic-mcp-v01249.gzemy54b` 已 verified/checksumsPassed/writersRestored；154 blob 匹配、writer 暂停约 7.001 秒后恢复。备份未做恢复演练。
- 固定导出 deploy exit0；生产 1357 源码与 `1e3fb140` 零差异，实际版本 0.12.49/0.13.3/0.6.1、Node24.18.0，3 服务 active、5 项健康通过。公网 HTML 与 5 入口资源逐字节匹配；previous 为 `/root/agentwiki-previous-20261019015824`。
- 真实 Chrome 已刷新线上指南并展开 WorkBuddy 0.13.3 prompt；公开 `/api/onboard` 200，固定版本、status 本地只读、continue 轮询、浏览器回退、真实网关字段、读页、权限/重启、移除不存在身份工具等八项核对通过。结构化回执已保存，截图仅私有保留，未重新发起授权。
- 旧 WorkBuddy 固定 0.13.2 + Node24 的本机真实授权、信任、两次完整重启和 reader MCP 读页已通过，旧证据独立保留。本轮部署后该既有连接新发起一次真实 MCP 读页，18:01:50.664Z completed、8156B/原 SHA 一致，仅 MCP 派发无替代工具；配置未改，原生 UI 已核实。本轮未重采 Node 进程证据，Node24 实际运行证明沿用此前独立回执；没有完成新的 0.13.3 默认接入验收。

# 稳定约束

- Git 命令在带尾空格仓库根显式 `--work-tree="$PWD"`；实际发布源码始终为冻结提交，后续文档不改变发布包。
- 新会话持久化精确包版本；缺失/不匹配 marker 在推进前返回 SESSION_VERSION_MISMATCH，保留检查点/token、不请求远端。旧会话用原启动命令的精确包继续，不改 version/planHash；MCP 历史诊断仍可只读查看。
- 发布/正式包回读、部署/健康、网页渲染、宿主真实调用分别记证。旧连接、curl、SDK 或模拟测试不能替代新接入真实验收。
- 私有截图、页面正文、凭据和备份不提交。既有发布授权有效，认证中断不等于授权撤销。

# 关键索引

- `.codex-memory/tasks/active/generic-mcp-onboarding-20261018/{brief,decisions,refs}.md`
- `agentwiki/docs/verification/workbuddy-guidance-20261019/{release-candidate.json,review.json,release.json}`
- `agentwiki/docs/releases-v0.12.49.md`
- `/tmp/agentwiki-0133-release-candidate/`：最终 tarball、文件 manifest 与候选门禁。
- `/tmp/agentwiki-release-0133-plan/`：本轮发布、协调备份、部署与线上验证原始回执。
- `agentwiki/docs/verification/generic-mcp-onboarding-20261018/`：0.13.2 发布和真实本机验收历史证据。

# 风险 / 下一步

1. 本轮 npm/生产发布、线上指南、既有客户端后端兼容验证及执行回执已完成；后续仍需处理默认路径问题，不重复发布或重新创建身份。
2. 默认 npx/safe-delete 与托管 Node22 仍属未解决产品问题，0.13.3 全新浏览器接入没有实测；当前本机已验证配置保持。
3. 不自动恢复覆盖快照后的用户写入；备份恢复演练未执行。
