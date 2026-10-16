# 当前目标

已完成10月16日复测剩余 #1/#2/#12/#13/#17/#19 的修复、正式发布与原环境回验；其余14项保留用户已确认结论。

# 范围 / 不做

- Web/API 0.12.46，release 42142cdc；Obsidian 0.5.11，tag固定7e81b9f，均已正式发布。
- Local Sync 0.13.0、protocol 0.6.1不变，无依赖升级、Prisma迁移或npm发布。
- 真实Vault只读回验，不执行Pull/Push/合并/覆盖，不修改账号授权；主检出用户修改保持原样。

# 当前状态

- Web五项均生产回验通过：#2在0.12.45发现旧个人模板仍漏，cfc1db6a补修后0.12.46同一原运行及截图对照三处中文；#12原报告编辑目录、#13常显关系删除入口、#17行内必填/空格/焦点、#19单日日期筛选正常。
- Web全仓7653通过/6既有跳过/0失败，typecheck/lint/build、独立审查通过。联合备份、1351源码/两个编译模块hash、三服务/health/63迁移/32业务smoke通过。
- Windows v2/head 410根因是清理legacy历史后正常首次v2链被误拒，服务端65e91103修复、02157186测试完善。官方插件0.5.10原NeoMei-Space只读回验已通过。
- 黄金书屋已在当前远程Windows真实Vault找到，官方0.5.10可只读加载，本地24/远端0；正文和基线未改。首次映射pending→active的操作来源未知，不追认因果。
- 正式0.5.11修复映射控制目录归档与退休runtime排空竞态，固定产品becc0a1独立复审通过，1526测试、Windows57机制测试及临时Vault原生加载/重载通过。CI正式资产/attestation验证完成；真实Vault已备份升级0.5.11，重启runtime正确且两Space只读通过，113正文文件/配置/映射/基线未变，只有树封装代次变化且payloadhash不变。

# 稳定约束

- Agent身份按目标实时Grant授权，不跨身份回退；正式文档读写用MCP且保持版本保护。
- 代码/机制测试、原生加载、真实Vault只读预览、内容同步写入分别留证；不把24本地变化写成24冲突或已同步。
- Git显式 --work-tree 指向带尾空格工作树。原报告、账号、生产响应和Vault文件清单只保留私有证据。
- 旧插件845920be/85b4078候选已撤回，不安装、不发布；正式0.5.11来自官方0.5.10基线。

# 关键索引

- .codex-memory/tasks/archive/retest-feedback-20261016/{brief,decisions,refs}.md
- agentwiki/docs/verification/retest-feedback-20261016/status.md 为当前交付结论；stage-history.md为冻结阶段历史。
- v0.12.46/{deployment.json,validation.json,production-ui-after-hotfix.md}。
- 插件工作树：/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/official-baseline-retest-20261016。
- 原报告：https://agentwiki.quukk.com/pages/4088516b-4f90-4803-aeb2-7ddc63a86c32。

# 风险 / 下一步

- 本轮六项代码修复、发布及约定原环境回验完成，任务已归档。黄金书屋当前同步身份viewer/canPublish=false（UI只读），24本地差异保留；未执行内容同步或修改权限。
- 两份未加载TEMP诊断文件删除被自动审批拒绝（仅返回blocked by policy），当前插件不使用它们，未绕过删除。
- 真实DataAdapter重绑/queued-rename竞态fixture未运行，不冒充Windows机制测试或临时原生加载证据。
- ordinary cutover历史清理仍保守拒绝，是既有限制，本次未放开retention。
- 配套应用/配置/数据库/附件备份和旧树保持；不单独回滚一半。
