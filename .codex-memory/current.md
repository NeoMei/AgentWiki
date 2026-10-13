# 当前目标

- 10-12 回归修复已完成 v0.12.24 发布、生产回读与 21 项反馈提交；剩余事项按原环境/产品规则/审核权限跟进。

# 范围 / 不做

- 已修复编辑态、来源/模板搜索、摘要、同名校验、协作缺项定位和引用输入提示；不更改历史运行/成员权限/父子完成语义。
- 保留 v0.12.22 的空间卡片、成员授权和 Plane 界面；无数据库迁移，Local Sync/Obsidian 未发布。

# 当前状态

- 发布 tag v0.12.24 / commit 7708a426aa88090f364d2de276acfce779e6085c；生产 1244 源码文件一致，三个服务健康，内外 health 全 ok，公网 smoke 32/32。
- 最终全量 7050 通过、6 环境跳过、0 失败，build/type/lint 通过；独立复审无 P1/P2。首屏 JS 546422/550000 字节。
- 生产 Chrome 已验证预览无提前缺项、提交 Toast 与字段聚焦、返回清错、同名单页中文拦截、引用输入提示。未启动外部 Agent。
- 最终 21 项回执 ChangeSet cmv6ki9jb00agfsg0v1m9sgr2 已提交并读回，pending_review，需所有者 xuehui 审核。旧 cmv69bve2080911615gw5fz6w 为过时早期反馈。

# 稳定约束

- 路径尾空格；Git 显式 --git-dir 和 --work-tree，不改共享 core.worktree，不重置主检出资料。
- 构建与完整测试顺序运行。发布前新建数据库/附件/应用配套备份，发布、测试、原环境回放分别记录。

# 关键索引

- agentwiki/docs/verification/regressions-20261013/status.md
- agentwiki/docs/verification/regressions-20261013/reply-v01224.md
- .codex-memory/tasks/active/regressions-release-20261013/{brief,decisions,refs}.md
- 工作树 /Users/neomei/.codex/worktrees/regressions-release-20261013/AgentWiki （实际路径尾空格）

# 风险 / 下一步

- 审核页面回执由 owner 完成；浏览器与 Agent 当前均 editor，不可代审批。
- #4 旧 Agent 暂停/失授权须决定恢复或新建；#7 待原账号浏览器回放；#9 父子完成语义待定。
- 删除 Agent 与输入时即时校验建议未实施；原生中文输入法、原附件、长文目录及管理权限视角有独立验收边界。
- 生产回滚备份 /var/backups/agentwiki/regressions-v01224.STptFpy7，previous /root/agentwiki-previous-20261013184857。
