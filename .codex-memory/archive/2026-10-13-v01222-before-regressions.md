# 当前目标

- “我的知识空间”卡片信息完善及发布完成，最终版本 v0.12.22。

# 范围 / 不做

- 页面数、成员数、审核策略、内容更新时间与明确进入入口已上线，桌面/手机布局保持简明。
- 包含正文更新时间与新建统计修复；未来原始时间提示待校准，不改用户数据。未发布 npm 或独立 Obsidian 插件。

# 当前状态

- GitHub v0.12.22 与生产发布完成，源码/tag `9e7169e1124efbd41a9bb55603f0a249a3d75a88`；root/server/client均0.12.22。
- v0.12.21 全部测试阶段最终7003pass/6既有skip；首次客户端一项超时经单测及完整客户端重跑通过。v0.12.22仅显示补修，Dashboard38项、tsc/lint/build及独立复审通过，不冒充全门禁重跑。
- 1240部署文件哈希匹配，环境文件不变，三服务running/0重启，内外五项健康ok。
- v0.12.22公网卡片7项通过并清理自有资源；v0.12.21通用公网32项烟测通过。Chrome真实账户桌面读验/390px截图通过，无横向溢出及控制台错误。
- 前期Plane风格内置模板/协作/任务看板/文档改版v0.12.19包含在本版本祖先中。

# 稳定约束

- 原仓库路径末尾空格；worktree Git显式--git-dir和--work-tree，不改共享core.worktree。
- 原检出及其未提交研究资料保持；不把浏览器读验等同于真实Agent执行。
- 用户业务数据未由本轮浏览器修改；API写验只使用可清理的自有账号与Space。

# 关键索引

- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.22
- https://agentwiki.quukk.com/dashboard
- agentwiki/docs/verification/space-cards-v01222-release.md
- .codex-memory/tasks/archive/dashboard-space-cards-20261013/{brief,decisions,refs}.md
- 发布工作树：`/tmp/agentwiki-release-v01221`，分支`codex/release-v0.12.22`。

# 风险 / 下一步

- 本次卡片改进、审查、GitHub与生产发布已完成，无待执行发布步骤。
- 既有未来时间仍保留原始值，界面明确提示待校准；来源数据修正属于另行定位，不擅自改写。
- 配套备份`/var/backups/agentwiki/cards-v01221.3zjZDWlu`已核验；保留旧应用，回滚须匹配数据快照。
