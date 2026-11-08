# 当前目标

用户已明确授权发布所有者可见性修复，正在准备 v0.12.66 冻结验证、GitHub Release 和生产部署。

# 范围 / 不做

Agent 列表、详情、空间成员、页面/目录绑定、协作角色绑定、任务改派显示真实所有者姓名与账号，支持中英文及未知所有者降级。不扩大管理权限，不改数据库，不调整仅含本人 Agent 的接入选择器。

# 当前状态

- 本地发布锁仍为 v0.12.65，HEAD f100ea9a，编辑前后 release guard 通过。线上状态本轮未重新核验。
- AgentService.list/getOwned、SpaceService.listMembers 明确 select owner 的 id/name/email；空间仍剥离原始 ownerId/credentials，canManageRole 规则保持。
- 客户端全量174suite/2949tests通过；其后特殊字符回归先红后绿，最终相关7suite/220tests通过；最后窄屏布局微调再验SpaceMembers14/14。
- 服务端相关4suite/89tests、server typecheck、client tsc/build、全部修改TS/TSX ESLint、diff check通过。最终初始JS550838/551000字节。
- 真实Chrome+本地Vite+夹具API桌面1440/手机390共9项检查通过，含列表→详情→暂停、同名不同所有者、他人Agent只读、中英、未知所有者、无横向溢出/控制台错误。未运行真实数据库或生产业务验收。
- 独立复核发现并修正姓名含美元替换序列的显示错误，最终无未解决finding。既有未跟踪design/保留。
- 上轮v0.12.65发布与审核/复制功能记录保留在归档，本轮所有者修复尚未上线。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，便捷入口 `/Users/neomei/项目/codexprojects/AgentWiki-current/agentwiki`，分支 `codex/agent-autochat-external-opencode`；origin直连GitHub。编辑发布前guard，历史检出禁止发布；deploy.sh打包工作树，发布必须用冻结clean detached树。生产root@113.249.120.24:/root/agentwiki；保留未跟踪design/。不记录密码/私钥/令牌。

# 关键索引

- tasks/active/agent-owner-release-20261109/{brief,decisions,refs}.md
- archive/2026-11-09-agent-owner-visibility.md（含上轮current快照）
- agentwiki/apps/client/src/features/agent/agentOwner.ts
- tasks/archive/space-review-release-20261028/{brief,decisions,refs}.md
- tasks/archive/space-review-policy-20261028/{brief,decisions,refs,plan,verification.json}
- tasks/archive/local-workspace-hygiene-20261028/brief.md
- tasks/index.md（既有原环境未验边界）

# 风险 / 下一步

所有者修复为本地未提交变更，发布前需冻结并验证候选、备份及生产读回。551000字节初始JS门禁保持。原账号/原生客户端与线上复制结果页实点待验仍按原任务保留，不由本轮夹具验收替代。上次发布的备份与回滚要求见release归档。
