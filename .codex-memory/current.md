# 当前目标

执行用户明确授权的 v0.12.57 / Local Sync 0.13.5 发布，包含《10-22Agentwiki测试问题》12项修复及宿主识别/连接身份修复。

# 范围 / 不做

发布本轮已验证修复。原报告逐项保留，不把发布健康或本地测试当作原billy环境人工验收；不改既有Agent、MCP配置或生产权限。

# 当前状态

- canonical `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`，分支`codex/agent-autochat-external-opencode`；基线`ec4faa7f`，v0.12.57守卫通过。
- 12项缺陷及宿主识别/连接身份修复、.13.5版本联动已完成并独立复审；旧.13.4会话继续固定原版本runner。
- 最终`pnpm test:full`一次性exit0：8223 pass/5环境skip；build/typecheck/lint、协议0.6.1官方parity、两种独立安装及publisher合约均通过。此前17项本地Chrome回归通过。
- 最终npm包179文件，sha256 b566ae2a895e17fc4d5d22645e8184bd484d333fe5a87af330b2e897349c9e05；npm认证已完成。待冻结提交并正式发布。
- 生产配对备份`bugs-v01257.oap6txmn`已校验及独立复核。最新只读预检：三服务/health正常，1409个旧源码与基线一致，线上仍.12.56/.13.4。
- 原报告已追加12条开发回复和12条本地回归，MCP精确回读及Chrome渲染通过，原文及18图完整保留。发布后追加上线证据。

# 稳定约束

编辑/发布前运行release guard；生产目标固定`root@113.249.120.24:/root/agentwiki`。Space授权实时查询，不为绕过拒绝换身份/密钥或用DB读写正文。发布需配对备份、冻结包/源码、npm回读及生产独立回验。

# 关键索引

- tasks/active/release-v01257-20261023/{brief,decisions,refs}.md
- tasks/active/bug-report-20261022/{brief,decisions,refs}.md
- tasks/active/onboarding-host-identity-20261023/{brief,decisions,refs}.md
- agentwiki/docs/verification/bug-report-20261022/release/README.md
- agentwiki/AGENTWIKI_RELEASE_CANDIDATE

# 风险 / 下一步

npm先发布临时tag release-0-12-57，精确包回读/空缓存验收后再部署Web .57；生产源码、资源、health及浏览器通过后提升latest。原billy环境及真实host升级后的MCP实际读取保持独立验收边界。
