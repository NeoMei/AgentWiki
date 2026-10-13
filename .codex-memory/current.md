# 当前目标

- 完成 10-12 回归报告补充缺口，发布 v0.12.24 并逐条回执；v0.12.23 已上线。

# 范围 / 不做

- 包含编辑态、来源筛选、模板来源、协作摘要及新建标题冲突修复；不改变任务看板父子完成语义，不推断原账号历史协作已经恢复。
- 保留 v0.12.22 的空间卡片、成员授权和 Plane 界面。没有数据库迁移，不发布 Local Sync 或 Obsidian 插件。

# 当前状态

- 独立发布工作树已基于 origin/master 6f6a13e9 整合，已发布 root/server/client 0.12.23，当前补丁候选为 0.12.24。
- 4 项独立审查 P2 及缩进代码块高亮缺口已修；发布后对应原截图复核发现8/8.1/15 composite路径/18缺口，正在两个隔离worktree补修。
- 定向回归、完整构建、类型检查、lint 通过，首屏 JavaScript 546413/550000 字节。本地 Chrome 已验收选区、邮箱/网址、高亮和代码原样显示。
- 首轮完整数据库门禁两项失败已修正执行次序和语义断言；完整门禁顺序重跑退出0，共7031通过、6项既有跳过、0失败，数据库230/230无跳过。
- v0.12.23 已发布并部署：1243源码一致、环境不变、61迁移最新、3服务稳定、内外health5项、公网smoke32通过；备份/previous见发布回执。
- 反馈 ChangeSet cmv69bve2080911615gw5fz6w 待所有者审核；当前用户 MeiXueFeng=editor、codex Agent=editor，均不可审批，未绕过权限。

# 稳定约束

- 路径末尾空格，git 显式 --work-tree；不改共享 core.worktree，不重置旧修复工作树或主检出用户资料。
- 全量门禁与构建须顺序执行，避免清理正在使用的 dist。
- 部署前新建数据库/附件/应用配套备份。原账号场景与本地fixture、测试和生产健康分别报告。

# 关键索引

- agentwiki/docs/verification/regressions-20261013/status.md
- .codex-memory/tasks/active/regressions-release-20261013/{brief,decisions,refs}.md
- /Users/neomei/.codex/worktrees/regressions-release-20261013/AgentWiki （实际路径末尾空格）
- /tmp/agentwiki-regressions-20261013/：门禁日志、备份脚本和发布说明。

# 风险 / 下一步

- 8/8.1/15 composite路径/18补丁已整合；独立复审发现异步预检取消/双击、已禁用任务角色、未知结果精确重试边界，已修正，57项定向与最终全量7050/6skip/0fail、build/type/lint通过，独立复审无P1/P2。正在生产备份，接着tag/release/deploy回读。
- v0.12.24首轮DB既有用例超时与macOS 17:41:46休眠489秒严格对应；同组单独重跑5/5通过。保留原失败记录，不改超时；最终门禁使用caffeinate防止空闲休眠。
- 生产目标 root@113.249.120.24，控制连接 /tmp/agentwiki-release-ssh/control；不要使用 deploy.sh 默认主机。
- 逐条页面回执需空间所有者 xuehui 审批；原 run、黄金书屋、原生中文输入法及任务看板语义保留待验。
