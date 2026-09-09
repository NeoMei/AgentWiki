# 当前目标

- 按用户已批准方案，从根本上解决 Obsidian 机器码入口不明、Agent 自动接入难以完成的问题。当前在本地候选集成与真实验收阶段。

# 范围 / 不做

- Obsidian 默认浏览器授权，手动连接码为有说明、有期限的后备入口；Agent 改为可恢复的分步 JSON 接入，连接与知识导入分离。
- 应用候选 0.11.0、Local Sync 候选 0.10.0、独立插件候选 0.5.0；主仓 Sync Protocol 保持 0.6.0，插件依赖的协议保持 0.5.1。候选尚未公开发布或部署生产。
- 保留旧 NDJSON/human/--code 流程和旧 Local Sync 0.9.0/0.9.1 服务端兼容。不改变 Folder/Page、权限、CAS、treeRevision、同步协议或 schema。

# 当前状态

- 集成分支 codex/connection-ux-20260909，工作树 .worktrees/connection-ux-20260909；原 master 基线 bbe5c1f5。服务端、CLI、网页已集成，独立插件工作树在 AgentWiki-Obsidian 仓库。
- 主仓运行代码 16db7cfd，Task1/2/4 及全新最终主分支审查的唯一修复增量均已独立复审关闭，无 Critical/Important 遗留。插件最终 5751424（0.5.0），原 I1–I4 及恢复回归全部关闭；累计 C0/I0/M1，M1 仅为 17 条基线 lint warning。
- 插件前一提交 6a7b142 完整 check 1350 通过；最终 5751424 的 65 项相关测试、typecheck/lint/build/bundle 通过，控制器独立重复 65 项及 bundle/metadata 通过。最终0.5.0已安装到本轮测试Vault，日常Vault未改。
- 真实 Codex 消费网页复制提示词，已完成浏览器授权、空间选择、确认、配置安装、网关验证；真实 MCP 读取被隔离验收宿主的工具审批策略阻止，未记为通过。
- Computer Use已在专用Vault完成最终插件加载、空间选择、ConnectionAcceptance映射、预览确认拉取、打开测试页读取正确标记；停用再启用插件后连接和映射仍已激活。Obsidian此成功路径验收通过。
- 集成构建发现新增测试的旧版本 literal，已校正并单独 build/6 项回归通过；完整client1447/server2602+专用DB3/LocalSync907通过，1项LocalSync原有跳过；typecheck/lint、干净安装和版本契约33通过。扩展runtime263通过/1平台跳过，DB206通过+1环境失败；失败文件改用独立空库后4/4通过，记录保留。

# 稳定约束

- Folder 为目录，Page 承载正文，folderId 为事实源。目录 Owner/Editor 可写，Admin/Viewer 不可写；super_admin 依实时 User 确认。
- 主仓路径末尾空格；Git 在仓库根显式 --work-tree。保留原 HANDOFF、历史失败证据、其他工作树/验收环境/日常 Vault 与用户内容。
- 只用本轮专用测试 DB、Redis、账号、Space、test home 与 Vault；发布、生产部署、真实客户端验收是独立门禁。

# 关键索引

- docs/superpowers/specs/2026-09-09-connection-ux-design.md
- docs/superpowers/plans/2026-09-09-connection-ux.md
- tasks/active/connection-ux-20260909/brief.md
- .superpowers/sdd/2026-09-09-connection-ux/progress.md 及各 task 报告
- 私有证据 /Users/neomei/.codex/recovery/agentwiki-connection-ux-20260909/
- 上轮已结束 v0.10.2 生产验收见 agentwiki/docs/verification/full-audit-v0102-20260909.md；不继承其发布授权。

# 风险 / 下一步

- 用户手工OpenCode读页失败已定位：运行公开0.9.1与生产旧连接，远程MCP返回401，网关静默退化为六个本地工具。候选测试连接实际SDK stdio发现27工具（21远程）且wiki_get_page读回正确标题/标记；这不等于OpenCode宿主验收通过。已补脱敏实时网关诊断与工具集合重载提示，独立复审C0/I0/M0。
- 新增网关回归中央66项通过，最后集合变化增量18项及build/lint通过；完整LocalSync923通过/1跳过/1源码锁旧测试超时，未改代码原样单文件重跑29通过，保留失败证据，不冒称单次完整全绿。
- Computer Use明确拒绝Terminal、Codex、Warp（for safety reasons），未绕过。已准备start-opencode-acceptance.py临时配置启动器，保留wiki_get_page交互审批，用户可在Warp新标签页执行；不改日常配置。真实宿主结果仍待回传。
- 0.10.0 尚未在 npm 公开发布；当前真实 Agent 验收仅将固定版本 npx 替换为相同候选 CLI 的隔离 home 包装器，不声称公开安装已经可用。
- 全新独立只读Codex审查（固定bbe5c1f5..735c58d8）原C0/I1/M0，唯一fix wave已复审关闭，见SDD/final-whole-fix-review.md。CU截图与computer-use-acceptance-result.json保存在本轮私有证据目录。
