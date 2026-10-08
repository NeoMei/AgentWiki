# 当前目标

- 10-08报告修复已发布：网页0.12.17上线，Obsidian插件0.5.7正式发布；保留原案待复验项。

# 范围 / 不做

- 用户明确要求“那就发布啊”，网页和插件已按授权发布。LocalSync0.11.0/协议0.6.1未变，不发npm。未安装日常Vault。
- 发布成功不等于原测试者15项原环境全部复验；待验边界继续保留。

# 当前状态

- 网页发布源码/tag v0.12.17为4d88ee2bb3af706050f5d88e038b7faf57ea0f2e，远端master已快进。实际生产三应用均0.12.17，API/Worker/Frontend active，公网默认TLS五项健康ok。1232个部署文件与提交一致，35项既有配置指纹未变，无待执行迁移。
- 精确网页发布SHA完整6952测试通过/6skip/0fail；runtime数据库230零skip；typecheck/lint/build通过，首屏542577/550000。6skip为2Windows、1独立CodeGraph、3专用连接授权门禁。最终及发布独审C/I/M=0/0/0。
- 网页与插件工作树仍保留：`/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `；`/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/test-fixes-20261008`。网页主检出旧产品源码和未提交研究资料未覆盖。
- 插件0.5.7发布SHA324fa53b3990fe276ebb1f12b4627a51e8a6b049，GitHub main/tag/CI/release/downloaded assets/attestations已核对。本地和CI1418项通过；未安装日常Vault。macOS原生SyncV2首次同步/三级目录/再次无差异证据仍属于e5b8a3a，后续仅错误文案与发布metadata变化，未冒称正式包原生重测。
- 原测试者Obsidian UNKNOWN_PARENT、黄金书屋Space原数据、原生中文IME和真实provider仍待验；当前生产浏览器会话未登录，只验公网首页/指南与新资源，不冒称生产逐项复验。
- 误删旧页3300a11b-0daf-4617-8e4c-ff008e069b85已19:09按原ID恢复并验收，部署后仍有效。禁止再次执行恢复脚本。

# 稳定约束

- 路径末尾空格；worktree git明确正确cwd和--work-tree。
- 不放宽权限/allowlist，不泄露凭据；正文/原案状态与发布分别记录。
- 备份、旧应用、工作树和隔离测试数据保留；日常Obsidian与既有PostgreSQL未停止。本轮临时Redis6392已保存关闭，生产SSH复用连接已退出。

# 关键索引

- 修复工作树 agentwiki/docs/verification/test-fixes-20261008/release.md 与 release-receipt.json
- 修复工作树 status.md、gates.md、receipts/ 保留全程候选/修正/发布回执
- .codex-memory/tasks/active/test-triage-20261008/brief.md
- GitHub网页：https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.17
- GitHub插件：https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.7

# 风险 / 下一步

- 原测试者复测还需要当前插件版本、日志/树结构及原Space可访问证据；不要把待验写成已关闭。
- 配套备份 `/var/backups/agentwiki/test-fixes-v01217.ysaZtxag`（数据库/应用/附件已校验）；旧应用 `/root/agentwiki-previous-20261008222652`。
- 网页lint3条、插件lint19条及旧开发依赖audit10项仍保留；本次插件生产依赖audit0不代表开发依赖已修。
