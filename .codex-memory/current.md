# 当前目标

跨页笔记看板及主站蓝色logo已随v0.12.64发布。新增复制按钮样式/反馈修复已在本地完成并验证，尚未发布。当前正式生产与GitHub latest仍为v0.12.64，冻结源码190ba1b34c2cb03691cc82bfbe4aa3bc2a7e725c。

# 范围 / 不做

已交付当前/全部双视图、授权跨页搜索/筛选/分页、空间笔记入口、来源与失效选区降级、返回筛选与有界位置恢复及蓝色logo。LocalSync保持0.13.5/protocol0.6.1；历史独有实现未批量合入，原账号/原生客户端待验边界仍按任务索引保留。

# 当前状态

- 本地新修复：创建完成与现有页面绑定结果的复制按钮统一为32px轻边框（手机44px），await剪贴板成功后勾选/已复制3秒，失败可见提示与重试，中英支持；59相关测试、client TypeScript/定向lint/build、7项本地Chrome（含真实clipboard读回、键盘、390px）及独立复核通过。尚未推送/发布，不将生产.64旧门禁当作该补丁的全仓验收。

- v0.12.64已正式发布部署，源码1461文件与冻结commit一致，Web/Client/API均.64；3服务active、5healthok，公网HTML及5入口资源匹配。
- 完整test:full退出0：8492pass/0fail/9条件skip，包含笔记发现31项真实PG；typecheck/lint/build、独立代码和回执复审通过，初始JS550514/551000。
- 本地和生产真实Chrome各13/13通过：双视图、跨空间/作者/@我/状态、正文/引用/标题、20+分页、来源与读/编辑/读返回位置、失效选区/已解决、重复高亮、390px、权限撤销和蓝色logo。
- 生产27笔记/4页面/3空间/2账号全部删除并读回；本轮临时DB/Redis/浏览器/干净detached发布检出已清理。敏感配对备份与匹配旧应用保留。
- origin直连GitHub、候选跟踪同名远端；6条失效worktree登记已清理，9个历史dirty状态已留恢复快照，旧主目录已本地归档。8个未跟踪design草稿保留。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，便捷入口 `/Users/neomei/项目/codexprojects/AgentWiki-current/agentwiki`，分支 `codex/agent-autochat-external-opencode`；origin直连GitHub。编辑发布前guard，历史检出禁止发布。deploy.sh打包工作树，必须从冻结干净detached树发布。生产root@113.249.120.24:/root/agentwiki，外部OpenCode2.1.1；保留未跟踪design/。

# 关键索引

- archive/2026-10-28-instruction-copy-feedback.md
- tasks/archive/notes-discovery-release-20261028/{brief,design,plan,progress,decisions,refs}.md
- agentwiki/docs/verification/notes-release-v01264-20261028/README.md
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.64
- tasks/archive/tianshu-logo-blue-20261028/brief.md
- tasks/archive/local-workspace-hygiene-20261028/brief.md
- 本地恢复 `/Users/neomei/.local/share/agentwiki-local-archives/20261028/`
- tasks/index.md（历史未验边界）

# 风险 / 下一步

9项条件skip分别为CodeGraph实际scanner opt-in1、专用connection DB3、专用taskboard DB4和Windows ACL1；不将其称为已测。原账号/原生桌面客户端验收继续保留原任务边界。配对备份 `/var/backups/agentwiki/notes-release-v01264.HTbMjvWN`，旧应用 `/root/agentwiki-previous-20261028015130`；恢复必须配对数据库/配置/附件并考虑备份后写入。后续功能需保持551000字节初始JS门禁。
