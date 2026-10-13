# 当前目标

- 将 10-12 回归报告的已实现修复发布为 v0.12.23，逐条保留原环境待验边界。

# 范围 / 不做

- 包含编辑态、来源筛选、模板来源、协作摘要及新建标题冲突修复；不改变任务看板父子完成语义，不推断原账号历史协作已经恢复。
- 保留 v0.12.22 的空间卡片、成员授权和 Plane 界面。没有数据库迁移，不发布 Local Sync 或 Obsidian 插件。

# 当前状态

- 独立发布工作树已基于 origin/master 6f6a13e9 整合，候选 root/server/client 0.12.23。
- 4 项独立审查 P2 及缩进代码块高亮缺口已修；最终复审无剩余 P1/P2。
- 定向回归、完整构建、类型检查、lint 通过，首屏 JavaScript 546413/550000 字节。本地 Chrome 已验收选区、邮箱/网址、高亮和代码原样显示。
- 首轮完整数据库门禁两项失败已修正执行次序和语义断言；完整门禁顺序重跑退出0，共7031通过、6项既有跳过、0失败，数据库230/230无跳过。
- 最近已发布生产记录仍为 v0.12.22；本轮尚未部署；生产授权连接已恢复，正在执行新备份。
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

- 提交并发布 GitHub；完成配套备份、deploy.sh、哈希/服务/迁移/公网/UI回读。
- 生产目标 root@113.249.120.24，控制连接 /tmp/agentwiki-release-ssh/control；不要使用 deploy.sh 默认主机。
- 逐条页面回执需空间所有者 xuehui 审批；原 run、黄金书屋、原生中文输入法及任务看板语义保留待验。
