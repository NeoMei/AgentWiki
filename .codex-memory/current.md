# 当前目标

处理 10 月 16 日复测报告剩余 #1/#2/#12/#13/#17/#19，保留其余14项用户已确认修复的结论。Web五项候选已通过独立审查和整仓门禁。用户指出插件已另行修复发布，现以正式0.5.10为准，通过现有Windows远程Session验证；不再交付旧插件候选。

# 范围 / 不做

- Web候选基线 v0.12.44 / 35f73159，分支 codex/retest-feedback-20261016；产品代码最终 07d6abc9。Local Sync 0.13.0 / protocol 0.6.1不变。
- 旧插件候选 codex/retest-baseline-20261016 已撤回；以正式0.5.10 / 2df7cfa为准，不合入旧mapping-detach实现。
- Web本轮未合并、推送、发布或部署，未修改生产报告。用户授权Windows远程验收后，已备份并升级正式插件0.5.10；连接、正文与原控制文件保持，未执行内容同步或覆盖。

# 当前状态

- #2：个人/Space普通单页的默认workflow从冻结定义识别，兼容合法 collaboration:null 与历史缺字段；自定义workflow不翻译。初版遗漏null已被独立审查抓出并修正复审。
- #17：所有必填统一行内提示与首错误聚焦，空白字符串拒绝，0/false和可选语义保留。
- #12：编辑目录统一滚动边界并用高度映射处理虚拟化；点击高亮随测量稳定，人工滚动立即恢复跟踪。原报告全文本地回放和1440/390px真实浏览器通过。
- #13：逐关系常显中英文删除按钮，保留确认/权限/API与失败上下文；两处既有异步测试等待已收紧，未改产品行为或弱化断言。
- #19：日期SQL参数转UTC无时区时间，与存储列对齐；真实浏览器→服务→PostgreSQL验证单日三条边界，前后天排除。
- #1：正式插件0.5.10 / 2df7cfa已另聊天发布并完成Mac原生Wiki零差异验收。Windows已由0.5.8升级0.5.10，官方三资产hash、进程重启和启用版本均核实；同步中心仍报远端版本过期，首条失败endpoint未捕获，根因待诊断。仅新增两个空tree-identities文件，原设置、正文、基线和事务未变。黄金书屋原Vault尚未定位，此错误不等于原基线身份错误。旧845920be组合审查有未修复并发P2，已撤回，不可安装/发布。
- Web typecheck/lint/build通过，初始JS 548270/550000。最终test:full exit0，7624通过/6既有跳过/0失败；完整结论见本轮status.md。

# 稳定约束

- Agent身份按目标实时Grant授权，不跨身份回退；文档正式读写用MCP并保持版本保护。
- 代码、独立审查、本地浏览器、生产上线及原环境验收分别留证；不以fixture或测试总数代替产品原案回验。
- 主检出有用户改动，保持原样。工作树路径尾空格，AgentWiki Git必须显式--work-tree。
- 原报告全文、账号及生产debug只保留本地私有/tmp文件，不进入public fixture或Git提交。

# 关键索引

- .codex-memory/tasks/active/retest-feedback-20261016/{brief,decisions,refs}.md
- agentwiki/docs/verification/retest-feedback-20261016/{status,progress,browser-acceptance,final-web-review,official-plugin-windows}.md
- Web工作树：/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki （尾空格）。
- 插件工作树：/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/retest-baseline-20261016。
- 最近已保存发布回执：agentwiki/docs/verification/directory-header-20261016/deployment.json、toolbar-height-20261016/deployment.json、menu-header-20261016/deployment.json。
- 原报告：https://agentwiki.quukk.com/pages/4088516b-4f90-4803-aeb2-7ddc63a86c32。

# 风险 / 下一步

- Web整仓门禁与本轮状态记录已完成；候选集成发布时重新核对远端基线，不能覆盖其他聊天改动。
- Windows正式版安装通过、差异加载未通过；下一次需要首条失败请求的路径/状态/错误码来定因。requestUrl通道未出现在可访问Network列表，不推定v3/head或旧revision。旧插件候选不再推进。
