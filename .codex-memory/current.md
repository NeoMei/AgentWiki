# 当前目标

审核方式改进与复制反馈已随v0.12.65正式发布部署，GitHub latest与生产冻结源ecf5f027a9cfa953aba264c47e49907d1c43041f一致。本轮发布完成。

# 范围 / 不做

新建空间（普通API/DB默认/快速接入）默认无需审核；创建时可选，空间标题旁owner快捷修改、Settings顶部独立卡片，保留基本草稿。复制按钮紧凑并提供成功/失败反馈。已有空间/待审不回填或批量批准，owner/Agent权限与生产rollout配置不变。LocalSync0.13.5/protocol0.6.1保持。

# 当前状态

- v0.12.65已正式Release及生产部署，1469源文件匹配冻结commit，3服务active/5healthok、公网HTML和5入口资源一致。
- 完整8540pass/0fail/9条件skip，.65types/lint/全包build与独立复审通过；初始JS约550626/551000。
- 生产104个既有Space审核策略逐ID比较及前后SHA完全保持；新默认和显式review都通过实际UI+API读回。
- 本地完整服务/生产隔离Chrome各11项策略与绑定检查通过，生产2users/3spaces/1page/1agent/1grant/1binding清理读回。
- 复制组件/本地fixture真实clipboard已验；生产临时Space未allowlisted，结果页clipboard实点明确notRun，未为验收改生产配置。两次额外本地尝试被原有rollout/Agent执行能力阻止，完整失败历史/清理保留。
- 配对备份与隔离恢复通过，临时本地DB/Redis/API/client、detached树及本任务SSHmaster清理；8个未跟踪design稿保留。
- canonical origin直连GitHub，历史检出本地归档与9个dirty恢复快照、6条失效登记清理保持有效。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，便捷入口 `/Users/neomei/项目/codexprojects/AgentWiki-current/agentwiki`，分支 `codex/agent-autochat-external-opencode`；origin直连GitHub。编辑发布前guard，历史检出禁止发布；deploy.sh打包工作树，必须用冻结clean detached树。生产root@113.249.120.24:/root/agentwiki；保留未跟踪design/。不记录密码/私钥/令牌。

# 关键索引

- tasks/archive/space-review-release-20261028/{brief,decisions,refs}.md
- agentwiki/docs/verification/space-review-release-v01265-20261028/README.md
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.65
- tasks/archive/space-review-policy-20261028/{brief,decisions,refs,plan,verification.json}
- archive/2026-10-28-instruction-copy-feedback.md
- tasks/archive/notes-discovery-release-20261028/brief.md
- tasks/archive/local-workspace-hygiene-20261028/brief.md
- 本地恢复 `/Users/neomei/.local/share/agentwiki-local-archives/20261028/`
- tasks/index.md（历史未验边界）

# 风险 / 下一步

9skip为CodeGraph真实scanner opt-in1、专用connection DB3、专用taskboard DB4、Windows ACL1；原账号/原生客户端待验仍按原任务保留。复制线上结果页实点未复验。配对备份 `/var/backups/agentwiki/space-review-release-v01265.KP7MhiQn`、匹配旧应用 `/root/agentwiki-previous-20261028142947`；回滚必须配对DB/配置/附件并考虑备份后写入。后续保持551000字节初始JS门禁。
