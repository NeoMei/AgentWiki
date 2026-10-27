# 当前目标

发布10-20测试报告补修v0.12.63。GitHub正式latest已发布，生产部署等待SSH认证。修复1a417a67，冻结发布c4fe12bda31e41c355735cd0d09dbcad834c30b5。

# 范围 / 不做

用户已明确授权“发布”。覆盖备份/隔离恢复校验/生产切换/公网与真实浏览器回归/原报告回复。npm和协议无变化。真实业务数据不用于验收，只创建并清理临时测试账号/Space。

# 当前状态

- GitHub v0.12.63已正式latest发布，非草稿/非预发布，tag解引用c4fe12bd；候选分支已推送。
- 全仓8425通过/0失败/5既有skip；build/typecheck/lint/guard通过；临时三DB和Redis已清理。
- 冻结干净树 `/private/tmp/agentwiki-v01263-tree-c4fe12bd/agentwiki`；manifest1443文件，准备回执在docs/verification/bug-release-v01263-20261027/。
- 生产SSH root@113.249.120.24返回Permission denied，ssh-agent无身份/无控制socket。已向用户请求在终端运行 `ssh -M -S /tmp/agentwiki-v01263-ssh root@113.249.120.24`，登录后保留连接。尚未收到完成信息；生产备份、部署、浏览器mutation均未执行。
- 公网health五项ok，不证明.63部署。最近已验收生产发布见20261026记录v0.12.62/2635bc66。
- 原报告追加源码发布及待部署状态，ChangeSet cmvqlcaoj1d4yp2owprbhefdj published，MCP精确回读通过；历史正文保留。

# 稳定约束

canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支 `codex/agent-autochat-external-opencode`；编辑/发布前guard。历史检出禁止发布。deploy.sh打包工作树，只从冻结干净detached树运行。生产root@113.249.120.24:/root/agentwiki，外部OpenCode2.1.1；Local Sync0.13.5/protocol0.6.1。保留用户未跟踪design/。

# 关键索引

- tasks/active/bug-report-20261027/{brief,decisions,refs}.md
- agentwiki/docs/verification/bug-release-v01263-20261027/{release-tools.md,deployment-status.json,preparation-receipt.json,production-browser-acceptance.mjs}
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.63
- https://agentwiki.quukk.com/pages/aa1739e9-092e-4b61-a4a1-8c63d634817a

# 风险 / 下一步

待用户完成SSH认证后验证控制socket，使用AGENTWIKI_SSH_CONTROL_PATH=/tmp/agentwiki-v01263-ssh。执行配对备份、verify-backup-restore.py隔离恢复校验，然后冻结树deploy.sh；host/public verifier校验1443文件/三服务/五health。部署确认后运行生产browser脚本（RELEASE_APPROVED=0.12.63 CONFIRM_REMOTE_E2E_HOST=agentwiki.quukk.com），临时资源清理，更新GitHub生产状态和原报告。最后清理本轮detached树。初始JS550990/551000门禁保留。
