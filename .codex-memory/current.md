# 当前目标

原报告第12项通知未读计数漏修已补发Web/API v0.12.58并回写；保留billy浏览器人工复验及独立npm latest认证。

# 范围 / 不做

仅修复NotificationService未读计数遗漏readAt:null；原报告18图、12项人工复测及历史开发回复保留。未改线上通知数据、未切换浏览器账号；Local Sync0.13.5和protocol0.6.1不变。

# 当前状态

- canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`；分支codex/agent-autochat-external-opencode；发布源码19da88ebc90c9213a3835403c69f60e3669c5d86，lock基线ec4faa7f，app/client/api0.12.58。
- #12根因是count(visibleWhere(false))统计所有可见已读历史；只改true。真实DB旧4组断言失败→新5pass/0skip；server3591pass/3既有环境skip、client通知9pass，typecheck/定向lint/build及独立审查通过。这是本轮定向+全server回归，不是再次test:full；.57全仓8223/5skip是前次证据。
- 生产1423源码、HTML/5入口资产、三服务/五health全通过，65迁移no pending。billy实际服务只读诊断unread1→0，保留已读历史1；通知ID/readAt状态哈希前后一致，无需数据修补。
- 原报告新增#12补修跟进，ChangeSet cmvl1my2g006icw07pgo8qd28 published，updatedAt2026-10-23T14:06:42.652Z；MCP精确回读、原文/18图保留，MeiXueFeng Chrome DOM核对通过。原报告1-11已有他人记录的人工通过，未冒充本轮亲测；#12原人工失败结论保留待billy再验。
- 本轮配对备份 `/var/backups/agentwiki/notification-v01258.uqg3e9fw` 校验并独立复核；previous `/root/agentwiki-previous-20261023220511` 保留。未做恢复演练。GitHub Release v0.12.58已创建。
- npm0.13.5仍已发布release-0-12-57；latest此前仍0.13.4且安全密钥验证超时，本轮未触发npm操作。真实host升级/重启/MCP读取保持独立。

# 稳定约束

编辑/发布前运行release guard；生产目标root@113.249.120.24:/root/agentwiki。Space授权实时查询，不绕过权限换身份或DB读写正文；本轮只读诊断仅通知元数据及真实服务返回，不伪造HTTP登录。恢复需考虑配对备份和备份后写入。

# 关键索引

- tasks/active/notification-unread-20261023/{brief,decisions,refs}.md
- tasks/active/bug-report-20261022/brief.md
- tasks/active/release-v01257-20261023/brief.md
- agentwiki/docs/verification/notification-unread-20261023/README.md
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.58

# 风险 / 下一步

billy浏览器重新读取后的未读/铃铛、单条/全部及跨标签人工复验待记录。npm latest仅在用户就绪后重新发起官方WebAuthn，不复用旧链接，不重发包。当前owned浏览器已关闭；本地临时测试数据库已清理，本轮临时冻结checkout已安全移除，源码和验证回执保留。
