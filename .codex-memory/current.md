# 当前目标

用户明确要求解决默认 npx 缓存删除拦截。0.13.3 默认缓存失败已在真实 WorkBuddy 重现；临时私有缓存的冷/热 npx CLI 均成功。新生成配置经客户端重新信任、34/34工具启用、再次完全重启后，新会话真实 MCP 诊断/空间/读页已返回成功，正文8156B与SHA核对通过，npm日志确认Node24/npm11；未捕获实时完整进程链。0.13.4/WebAPI0.12.50 源码修复、独立审查及最终打包门禁均通过；新版本待明确发布批准，尚未发布。上一轮 npm0.13.3/WebAPI0.12.49 发布事实保留。

# 范围 / 不做

- 本轮候选 Web/API/client/root 0.12.50、Local Sync 0.13.4；当前生产仍0.12.49/0.13.3。protocol 0.6.1、依赖、lockfile 与数据库结构不变。
- 上轮修复授权轮询、真实 MCP 诊断指引及跨版本误续进；本轮新增 WorkBuddy npm 临时缓存与网关运行时绑定，不改变或关闭安全保护。
- WorkBuddy 原官方0.13.2固定CLI配置已备份，当前由新生成器写入官方0.13.3 npx+Node24+私有临时缓存配置验收。保留原connection/reader身份/Space授权、当前Codex0.13.0、原检出修改与日常Vault。旧回执不覆盖。
- 不索取或输出认证材料；数据库恢复不自动执行，须单独评估快照后用户写入。

# 当前状态

- 本轮0.13.4候选完整prepack75文件/1121通过/1既有Windows skip，类型/lint/前后端构建/协议parity/空缓存179文件比对通过。固定包SHA256 `d8dc68a986ff9716055a1731a8ee48aabdbff6ce31525f50aaca38e019b3dde0`；独立审查无开放问题，源码基线1362文件零差异。新生成npx配置已在真实WorkBuddy启动正式0.13.3并完成信任、完整重启、三次MCP调用与读页哈希核对；本轮未发布。
- 上一轮正式候选冻结 `1e3fb14001ec33f1c77be1dbfe86f9b02406d382`；独立审查无阻塞。最终 prepack 74 文件/1085 通过/1 Windows 专属 skip；版本契约 46、服务端兼容 202、公开指南 3、网页 47 通过，构建/lint/diff 与官方 protocol parity 通过。
- npm publish 已认证成功、exit0；metadata 先开放而 tarball 短暂 404 后，官方 version/latest 均 0.13.3，正式包 SHA256 `032773b2da2ddd8e53d1dd1aefe42922dfe0d9d58f0a9d803a0ea0ab333acdf3` 与冻结包一致。175 文件匹配、空目录/空缓存安装 0.13.3 + protocol 0.6.1 通过。
- 新协调备份 `/var/backups/agentwiki/generic-mcp-v01249.gzemy54b` 已 verified/checksumsPassed/writersRestored；154 blob 匹配、writer 暂停约 7.001 秒后恢复。备份未做恢复演练。
- 固定导出 deploy exit0；生产 1357 源码与 `1e3fb140` 零差异，实际版本 0.12.49/0.13.3/0.6.1、Node24.18.0，3 服务 active、5 项健康通过。公网 HTML 与 5 入口资源逐字节匹配；previous 为 `/root/agentwiki-previous-20261019015824`。
- 真实 Chrome 已刷新线上指南并展开 WorkBuddy 0.13.3 prompt；公开 `/api/onboard` 200，固定版本、status 本地只读、continue 轮询、浏览器回退、真实网关字段、读页、权限/重启、移除不存在身份工具等八项核对通过。结构化回执已保存，截图仅私有保留，未重新发起授权。
- 旧 WorkBuddy 固定 0.13.2 + Node24 的本机真实授权、信任、两次完整重启和 reader MCP 读页已通过，旧证据独立保留。本轮部署后该既有连接新发起一次真实 MCP 读页，18:01:50.664Z completed、8156B/原 SHA 一致，仅 MCP 派发无替代工具；配置未改，原生 UI 已核实。本轮未重采 Node 进程证据，Node24 实际运行证明沿用此前独立回执；没有完成新的 0.13.3 默认接入验收。

# 稳定约束

- Git 命令在带尾空格仓库根显式 `--work-tree="$PWD"`；实际发布源码始终为冻结提交，后续文档不改变发布包。
- 新会话持久化精确包版本；缺失/不匹配 marker 在推进前返回 SESSION_VERSION_MISMATCH，保留检查点/token、不请求远端。旧会话用原启动命令的精确包继续，不改 version/planHash；MCP 历史诊断仍可只读查看。
- 发布/正式包回读、部署/健康、网页渲染、宿主真实调用分别记证。旧连接、curl、SDK 或模拟测试不能替代新接入真实验收。
- 私有截图、页面正文、凭据和备份不提交。上一轮0.13.3/0.12.49发布授权已执行；本轮新0.13.4/0.12.50在候选可审后另请用户明确发布，不执行生产写入。

# 关键索引

- `.codex-memory/tasks/active/generic-mcp-onboarding-20261018/{brief,decisions,refs}.md`
- `agentwiki/docs/verification/workbuddy-guidance-20261019/{release-candidate.json,review.json,release.json}`
- `agentwiki/docs/releases-v0.12.49.md`
- `/tmp/agentwiki-0133-release-candidate/`：最终 tarball、文件 manifest 与候选门禁。
- `/tmp/agentwiki-release-0133-plan/`：本轮发布、协调备份、部署与线上验证原始回执。
- `agentwiki/docs/verification/generic-mcp-onboarding-20261018/`：0.13.2 发布和真实本机验收历史证据。

# 风险 / 下一步

1. 最终0.13.4 pack门禁通过并准备冻结；请用户批准本轮新版本发布后执行官方npm回读/生产备份部署/新正式包WorkBuddy读页。
2. 启动命令变化后WorkBuddy需在「专家·技能·连接器→连接器→自定义连接器」重新信任；已纳入安装提示。首次重启未信任导致无工具的失败证据独立保留，信任后启动成功。不冒充重新完成了新浏览器授权。
3. 不自动恢复覆盖快照后的用户写入；备份恢复演练未执行。
