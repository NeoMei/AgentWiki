# 当前目标

2026-10-19 用户授权的图谱界面优化及原反馈页三项登录/注册提示修复已发布为 Web/API 0.12.51，并完成生产验收与原页逐项更新。

# 范围 / 不做

本次保留生产0.12.50的通用MCP/WorkBuddy已发布修复，Local Sync保持0.13.4、protocol保持0.6.1。没有新增依赖、锁文件变更或数据库迁移；未包含后续未发布dd421dec。主检出用户修改、日常Vault、既有Agent身份与授权均保留。

# 当前状态

- 固定发布提交800dce6fa4214a31abda9e8d69c976b2d3a18b9e；GitHub master/分支及v0.12.51标签、正式Release已发布。后续回执提交不改变部署源码。
- 全量7868通过/6既有skip：runtime309、数据库239、server3355、client2704、protocol140、localSync1121。build/typecheck/lint通过，首屏JS549973/550000 bytes；独立冻结复审通过。首次并行build清理dist导致4项模块缺失，构建完成后全量串行重跑全部通过，无产品代码变更。
- 生产1365源码逐项匹配；公网HTML和5入口资源匹配；API/worker/frontend均active，5健康字段ok，63迁移无pending。32公网冒烟通过且临时资源清理成功。
- 真实Chrome图谱17页/5目录/0关系，搜索、详情、缩放适配、目录展开及390px无整页横溢出通过，已恢复桌面。IAB真实生产登录/注册无效邮箱0请求，服务端400字段兜底，重复邮箱409/AUTH_EMAIL_IN_USE、去登录及邮箱保留、中英文通过；窄屏布局检查通过。
- 原反馈页117ada12-8288-4055-b547-459db6dc4c54，通过用户明确授权的现有浏览器账号逐项更新为已发布0.12.51，并补充开发线上验收；重载后全文精确回读，3图/报告原文/3测试回归字段保持，阅读页渲染通过。MCP身份和Space授权未变。
- 配套备份/var/backups/agentwiki/graph-auth-v01251.86cj49b1：数据库、应用、配置及完整附件目录校验通过；159永久Blob、548全附件条目匹配，writer暂停7.496秒后恢复。previous应用/root/agentwiki-previous-20261019194514保留，未做恢复演练。

# 稳定约束

Git在对应工作树cwd下显式--work-tree指向带尾空格路径，不指定common --git-dir；测试清除GIT_WORK_TREE/GIT_DIR，且不得与会清理dist的build并行。发布以实时生产源码基线核对为准，origin/master可能落后于生产。备份快照后的新写入不在恢复点内，不自动数据库回滚。

# 关键索引

- agentwiki/docs/releases-v0.12.51.md
- agentwiki/docs/verification/graph-auth-release-20261019/release.json
- agentwiki/docs/verification/registration-feedback-20261019/developer-replies.md
- /tmp/agentwiki-graph-auth-release-20261019/ 保存原始验证日志和私有页面截图
- 当前分支codex/graph-ui-polish，工作树/Users/neomei/.codex/worktrees/graph-ui-polish/AgentWiki （路径尾空格）

# 风险 / 下一步

发布、开发侧线上验收和原页回复均完成；原测试人员的回归仍待其执行，未代填“通过”。恢复演练及Windows原环境回归不属于本轮已完成结论。工作树、备份和previous应用保留。
