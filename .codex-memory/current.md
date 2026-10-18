# 当前目标

- 2026-10-19通用MCP/WorkBuddy：真实新接入被生产device/start HTTP400阻断（只接受旧3client），未打开授权页。WorkBuddy5.8.3已真实完全退出重启，新会话通过原有0.13.1连接调用wiki_get_page读到项目总览；这不代表新流程通过。0.12.48/0.13.2发布候选已冻结0a299231、门禁和独立审查通过，发布许可问题已提出，尚未发布部署。见 tasks/active/generic-mcp-onboarding-20261018/brief.md 与 workbuddy-real-acceptance.md。

2026-10-17反馈8项核实、修复、正式发布、生产回验和原页逐项反馈已完成。保留原Windows与原黄金书屋wrapper错误的验收边界。

# 范围 / 不做

本轮Web/API0.12.47、Local Sync0.13.1、Obsidian0.5.12已发布；未变更protocol0.6.1、依赖或数据库结构。原检出用户修改、日常Vault、正文/事务/身份/hash保持。未升级当前Codex的0.13.0配置或强制重启。

# 当前状态

- Web/API正式代码a192d775，tag v0.12.47；后续仅回执文档提交。生产1354源码匹配，编译审核服务同hash，公网5资源匹配，3服务active/5健康字段ok，63迁移无pending，32烟测及清理通过。
- npm0.13.1已正式发布，官方包与固定候选逐字节/171文件一致；空目录/空缓存安装及正式SDK顶层schema/原页发布/精确回读通过。临时验收进程复用唯一既有连接并已关闭，不新增身份。
- 插件0.5.12正式源码fd06387，3 CI success，官方3资产逐字节/来源证明通过，完整1551项。原Windows待验，日常Vault未升级。
- 主最终full exit0：server3318/4skip、client2659、protocol140、local1018/1skip、runtime309/1skip、串行DB239/0skip；build/typecheck/lint及独立审查通过。
- 真实Chrome：10/14共53条3页53唯一ID、3状态全局倒序和日期通过；10/15共5条通过。来源/内嵌Runs/设置0重复返回且7nav，390px切换无整页横溢出通过；恢复桌面。
- 原页8项正式回执cmvc730wt00albu4scw93k18c published/autoPublished，全文精确/独立MCP回读及Chrome渲染通过。原报告、图片、测试人员回归栏和历史候选记录保留。
- 最新配套备份/var/backups/agentwiki/retest-feedback-v01247.xgdw975j已校验并恢复writers；旧应用树/root/agentwiki-previous-20261017172214保留，未演练恢复。

# 稳定约束

Git仅单条命令显式--work-tree指向带尾空格工作树；测试清除GIT_WORK_TREE/GIT_DIR，避免污染临时git init。唯一MCP身份与Space动态授权不变；旧0.13.0未完成接入继续原固定版本命令，不改version/hash。私有生产截图与正文不提交。

# 关键索引

- .codex-memory/tasks/archive/retest-20261017/{brief,decisions,refs}.md
- agentwiki/docs/verification/retest-20261017/{release.json,npm-release.json,plugin-release.json,status.md,acceptance.md,validation.json}
- .superpowers/sdd/retest-20261017-plan/release-sdk/final-release-receipt.json
- /tmp/agentwiki-release-20261017/ 备份、部署、源码/public验证、烟测、full原始日志

# 风险 / 下一步

- 本轮接入候选仍沿用基线版本常量0.13.1以待统一发布准备；已发布npm0.13.1不含generic/workbuddy新功能。正式发布必须提升新包版本并同步Web/API允许范围与命令，不能将未发布源码提示词用于现网安装。原WorkBuddy宿主实际授权/重启/已知页读取待验。

本轮发布工作完成。Windows原Vault/事务另行原环境回归；黄金书屋原wrapper错误未复现，不借本次项目管理Space成功结论关闭。其他客户端旧进程不会因npm发布自动升级；既有Codex0.13.0配置保留。工作树和备份为交付证据保留。
