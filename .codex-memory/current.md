# 当前目标

- 10-08报告修复已发布：网页0.12.17上线；Windows真实同步发现的预览问题已追加修复并发布插件0.5.8。0.5.8临时Vault的最终原生冲突验收已通过，合成生产资源已撤销，原案待验边界保留。

# 范围 / 不做

- 用户已明确授权修复、发布与通过既有Windows Session执行真实同步；不重复请求许可。
- Local Sync0.11.0/协议0.6.1未变，不发npm；日常Vault不安装测试插件、不终止共享Obsidian进程。
- 只用独立合成私有账号/Space验收；不把合成场景和源码测试写成原测试者15项全部复验。

# 当前状态

- 网页v0.12.17部署源码4d88ee2bb3af706050f5d88e038b7faf57ea0f2e，生产回读三应用/服务/健康通过，1232文件匹配、35配置指纹不变，无待迁移。完整6952通过/6skip，数据库230零skip，构建/类型/lint通过，首屏542577/550000。master后来增加Windows包管理器415f45f3与回执，不改写部署tag。
- 插件0.5.8正式SHA b9be0afa667e216c87a15f983431109f79b5ca39：V3动态摘要、V2冲突选择即时校验及摘要重算已修，独立审查通过；最终70文件/1422测试及格式/类型/构建/bundle门禁通过，lint0error/19既有warning。main/tag/源分支CI、Release全部成功；三资产SHA/digest/attestation独立复核精确匹配。
- Windows既有Session 01a0f8b8-b64c-7c80-9114-789d6f72dfc8 / host remote-control:env_e_6a53e3dc9b0483268a860e1de83e99c3 可用，明确host的read_thread可取真实命令回执；列表/wait_threads异常不能推断离线。
- 正式0.5.7已在Windows Obsidian1.13.7完成真实连接、多级映射、V2首拉/本地推送/远端拉取、父目录删除保护/服务器恢复/手动目录迁移，以及68B图片升级Sync v3并零差异。正文/Keep哈希和实际路径有回读。此轮复现两类预览问题，推动0.5.8。
- 正式0.5.8已在Windows真实加载，三个文件哈希一致、运行版本0.5.8、既有V3零差异；重载后的旧设置页按钮未反应，不能仅凭此判回归。旧fixture随后被部分删除，新的合成账号/Space/映射已通过A远端正文更新拉回、B V2即时父目录保护/恢复、C V2手动摘要/迁移、D图片升级、E V3手动摘要/迁移；C/E页面和Keep两端SHA一致，最终V3零差异，结果见新原生回执。
- 第一轮两个生产合成Space和设备凭据已删除、账号已删除且旧JWT401。递归删除临时根目录被执行器拒绝；随后一次.NET删除尝试已被叫停，残余目录保留，禁止换方式绕过。0.5.8新fixture亦已实际断开：Space删除200/树404、凭据撤销204、账号删除200/旧JWT401；已兑换installation删除409不当作成功删除，本地目录保留。
- 原测试者UNKNOWN_PARENT的原数据/日志/树结构、黄金书屋原Space、原生中文IME和真实provider仍待验。误删页3300a11b-0daf-4617-8e4c-ff008e069b85已按原ID恢复并验收，禁止再执行恢复。

# 稳定约束

- AgentWiki目录末尾空格，worktree Git使用正确cwd及显式--work-tree；不改共享core.worktree。
- 主检出旧源码和未提交研究资料保留；不得泄露密码/Token/连接码，不放宽权限与allowlist。
- 生产备份、旧应用保留；日常Obsidian与既有PostgreSQL不停止。未再次部署未变网页。

# 关键索引

- 当前验收工作树：`/Users/neomei/.codex/worktrees/test-fixes-win-receipts-20261009/AgentWiki `。原test-fixes-20261008工作树实际已缺失，仅app附件仍列出；从已推送e3d5d0e3创建新隔离工作树承接回执，未猜测缺失原因。
- 插件工作树：`/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/test-fixes-20261008`。
- agentwiki/docs/verification/test-fixes-20261008/ 下status.md、release.md、release-receipt.json；receipts/windows-live-sync-20261009.md与脱敏JSON、plugin-0.5.8-final-check.log及release-verification.json。
- .codex-memory/tasks/active/test-triage-20261008/brief.md
- 网页 https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.17；插件 https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.8。

# 风险 / 下一步

- 正式0.5.8新fixture真实同步与冲突证据已齐；本轮生产资源撤销有回执，保留本地证据；无原案实测的项目继续待验。
- 生产备份 `/var/backups/agentwiki/test-fixes-v01217.ysaZtxag`；旧应用 `/root/agentwiki-previous-20261008222652`。
- 网页lint3条、插件lint19条与旧开发依赖audit10项未宣称修复。
