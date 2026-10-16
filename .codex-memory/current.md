# 当前目标

完成 10 月 16 日复测报告剩余 #1/#2/#12/#13/#17/#19 的修复、生产发布与原环境回验；保留其余14项用户已确认结论。

# 范围 / 不做

- Web/API 0.12.46/42142cdc已生产部署，产品cfc1db6a，分支 codex/retest-feedback-20261016；前版0.12.45/a80746e6回执保留。Local Sync0.13.0/protocol0.6.1不变，无依赖、Prisma迁移或npm发布。
- 旧插件候选已撤回，不安装不发布；基于正式0.5.10另行补修映射与后台写入竞态。生产正文同步、Pull/Push或覆盖不在只读验收操作内。
- 主检出有用户修改，保持原样；本任务隔离工作树发布。

# 当前状态

- Web #2普通单页默认workflow本地化、#17必填行内校验/聚焦、#12编辑目录定位高亮、#13常显删除关系入口、#19UTC日期边界均已修复、独立审查和本地真实浏览器通过。
- Windows官方0.5.10的真实v2/head 410已定位为已清理legacy历史后的普通首次v2链被误拒。65e91103新增最窄可信边界，02157186完善DB测试清理；完整hash/parent/连续性检查保留。真实生产数据只读候选验证通过，fixed-HEAD独立审查PASS。
- 最终整仓7644通过/6既有跳过/0失败；typecheck/lint/build全部exit0，initial JS548270/550000。v0.12.45 / a80746e6已发布部署；联合备份、1351源码hash、服务端编译模块、公网5入口资源、三服务、health及32项smoke通过，见本轮deployment.json。
- 原Windows黄金书屋映射已找到，官方0.5.10只读差异加载显示本地24项/远端0项，未出现原身份错误，正文与基线保持不变。另一个映射的官方0.5.10原生只读回验确认410已消失，Sync v2、本地0变化、服务器有更新（数量未知），未同步写入，正文与基线不变。
- 新插件修复尚在独立补修/审查中，不以已有0.5.10安装或Web上线作为新插件交付。

# 稳定约束

- Agent身份按目标实时Grant授权，不跨身份回退；文档正式读写用MCP并保持版本保护。
- 代码、独立审查、本地浏览器、生产上线、Windows原案分别留证；不以fixture或测试总数替代原环境复验。
- Git必须显式 --work-tree 指向带尾空格的工作树。
- 原报告全文、账号、生产debug及完整Vault清单仅保留私有临时证据，不提交公开仓库。

# 关键索引

- .codex-memory/tasks/active/retest-feedback-20261016/{brief,decisions,refs}.md
- agentwiki/docs/verification/retest-feedback-20261016/ 下的 status.md、validation.json、release-preparation.md、server-chain-review.md、backup-receipt.json
- Web工作树：/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki （尾空格）。
- 新插件工作树：/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/official-baseline-retest-20261016。
- 原报告：https://agentwiki.quukk.com/pages/4088516b-4f90-4803-aeb2-7ddc63a86c32。

# 风险 / 下一步

- #2真实历史个人模板仍英文的缺口已补修cfc1db6a，fresh审查PASS、独立144测试通过、整仓7653通过/6跳过/0失败，最终typecheck/lint/build通过；0.12.46已备份、发布并部署，1351源码hash、两个编译模块、三服务/health/63迁移/32项smoke通过；仍需同一真实运行原生回验。

- 0.12.45生产#12/#17/#19原生回验通过，#13常显入口通过；临时Space/page/template已精确删除，浏览器capture/session已停止。0.12.46上线后复验#2原运行。
- 保留旧数据库+应用+附件同组备份，不单独回滚任何一半。
- 新插件待竞态补修后的固定候选复审、完整check与Windows验收，再独立发布。
- 服务端ordinary cutover的历史清理仍保守拒绝，属于既有限制，本次读链修复没有放开retention。
