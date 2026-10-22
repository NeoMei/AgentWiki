# 当前目标

本轮Web/API v0.12.57、Local Sync0.13.5及GitHub Release已发布，完成剩余npm latest标签切换；原billy业务回归保持独立。

# 范围 / 不做

本轮12项Bug及宿主识别/当前连接诊断修复已上线。原报告原文和18图完整保留；不把源码/健康/本地测试当作原billy人工验收，不改既有Agent或MCP配置。

# 当前状态

- canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`；分支`codex/agent-autochat-external-opencode`；发布源码commit `192315ed13e43df6d4a88dd7572076dbaca5fb19`，release lock基线ec4faa7f，v0.12.57。
- 单次full suite 8223 pass/5环境skip；build/typecheck/lint、protocol0.6.1官方parity、两种pack安装、179文件正式npm包/空cache/合约及独立字节复核通过。
- npm0.13.5已发布并验证在release-0-12-57标签；latest仍0.13.4。latest操作单独WebAuthn超时，CLI47656已E404结束，help2223已取消；需要用户就绪后重新发起，不复用旧URL。
- 生产部署exit0。1422源码、5包版本、HTML/5公网资源一致；三user服务、五项health正常；65 migrations无pending；14 runtime guide与外部OpenCode2.1.1 CLI探针通过。GitHub Release v0.12.57/资产哈希及tag指向192315ed已回读确认。
- 配对备份 `/var/backups/agentwiki/bugs-v01257.oap6txmn` 校验通过；previous `/root/agentwiki-previous-20261023015646`。未做恢复演练。
- 原Bug页追加12条发布跟进（ChangeSet cmvjujvlh006kaba3m4yav8wz），updatedAt2026-10-22T18:00:35.864Z；MCP精确回读与Chrome12条发布/24条先前回复/18图元素全部通过。公开guide三客户端也通过。

# 稳定约束

编辑/发布前运行release guard；生产目标固定`root@113.249.120.24:/root/agentwiki`。Space授权实时查询，不绕过授权换身份或DB读写正文。恢复需考虑配对备份及备份后写入；真实host升级/重启/MCP读页和原业务场景独立验收。

# 关键索引

- tasks/active/release-v01257-20261023/{brief,decisions,refs}.md
- tasks/active/bug-report-20261022/{brief,decisions,refs}.md
- tasks/active/onboarding-host-identity-20261023/{brief,decisions,refs}.md
- agentwiki/docs/verification/bug-report-20261022/release/README.md
- https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.57

# 风险 / 下一步

仅剩npm latest推广认证。用户准备好时运行 `npm dist-tag add @neomei/agentwiki-local-sync@0.13.5 latest --registry=https://registry.npmjs.org/ --browser=false`，打开新官方链接让用户完成安全密钥，随后回读dist-tags。无需重发包、重建或重新部署。若清理本轮tag，只在确认指向.5后处理；不更改任何其他tag。原billy的12项人工复验、真实客户端升级后的读取、Windows行为仍未冒充完成。
