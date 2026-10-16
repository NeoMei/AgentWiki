# 当前目标

处理 10 月 16 日复测报告剩余 #1/#2/#12/#13/#17/#19，保留其余14项用户已确认修复的结论。Web和Obsidian均已形成可构建候选，分任务及整支独立审查通过；最终整仓门禁通过。

# 范围 / 不做

- Web候选基线 v0.12.44 / 35f73159，分支 codex/retest-feedback-20261016；产品代码最终 07d6abc9。Local Sync 0.13.0 / protocol 0.6.1不变。
- 插件候选在 AgentWiki-Obsidian 独立工作树 codex/retest-baseline-20261016，基线 0.5.9 / f9004ff。另一个聊天的远端归档恢复工作树不在本轮范围。
- 本轮未合并、推送、正式发布、部署或安装日常插件；不修改生产报告、授权或用户Vault。Windows原环境待验不因代码测试通过关闭。

# 当前状态

- #2：个人/Space普通单页的默认workflow从冻结定义识别，兼容合法 collaboration:null 与历史缺字段；自定义workflow不翻译。初版遗漏null已被独立审查抓出并修正复审。
- #17：所有必填统一行内提示与首错误聚焦，空白字符串拒绝，0/false和可选语义保留。
- #12：编辑目录统一滚动边界并用高度映射处理虚拟化；点击高亮随测量稳定，人工滚动立即恢复跟踪。原报告全文本地回放和1440/390px真实浏览器通过。
- #13：逐关系常显中英文删除按钮，保留确认/权限/API与失败上下文；两处既有异步测试等待已收紧，未改产品行为或弱化断言。
- #19：日期SQL参数转UTC无时区时间，与存储列对齐；真实浏览器→服务→PostgreSQL验证单日三条边界，前后天排除。
- #1：映射移除归档完整控制目录；持久化意图与settings决定中断恢复，pending事务阻断，严格身份/哈希检查保留。插件1478测试及独立37测试、类型/lint/格式/build/bundle通过；Windows/native尚未验证。
- Web typecheck/lint/build通过，初始JS 548270/550000。最终test:full exit0，7624通过/6既有跳过/0失败；完整结论见本轮status.md。

# 稳定约束

- Agent身份按目标实时Grant授权，不跨身份回退；文档正式读写用MCP并保持版本保护。
- 代码、独立审查、本地浏览器、生产上线及原环境验收分别留证；不以fixture或测试总数代替产品原案回验。
- 主检出有用户改动，保持原样。工作树路径尾空格，AgentWiki Git必须显式--work-tree。
- 原报告全文、账号及生产debug只保留本地私有/tmp文件，不进入public fixture或Git提交。

# 关键索引

- .codex-memory/tasks/active/retest-feedback-20261016/{brief,decisions,refs}.md
- agentwiki/docs/verification/retest-feedback-20261016/{status,progress,browser-acceptance,final-web-review}.md
- Web工作树：/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki （尾空格）。
- 插件工作树：/Users/neomei/项目/codexprojects/AgentWiki-Obsidian/.worktrees/retest-baseline-20261016。
- 最近已保存发布回执：agentwiki/docs/verification/directory-header-20261016/deployment.json、toolbar-height-20261016/deployment.json、menu-header-20261016/deployment.json。
- 原报告：https://agentwiki.quukk.com/pages/4088516b-4f90-4803-aeb2-7ddc63a86c32。

# 风险 / 下一步

- Web整仓门禁与本轮状态记录已完成；候选集成发布时重新核对远端基线，不能覆盖其他聊天改动。
- 插件需和另一工作树的远端归档恢复功能单独整合审查，再安排原Windows Vault复测。本轮不声称Windows不兼容已经被证明或彻底解决。
