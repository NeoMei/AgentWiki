# 文档工作区优化

用户于2026-10-06批准实施；六项计划现已完成并独立审查。

隔离工作区：/Users/neomei/.codex/worktrees/document-workspace/AgentWiki （尾空格）。分支codex/document-workspace，基线c7b89567，产品提交897aa3f8。

范围：统一阅读编辑画布/大纲，目录就地操作与偏好，手工工具与页面链接，本机草稿恢复，精确Agent候选与私人批注队列，提案Markdown差异。Tiptap17组保真试点失败，保留CodeMirror生产引擎。

验收：客户端1844、服务端2838、协议140、LocalSync942、runtime479通过，合计6243通过/6跳过；全仓类型/lint0errors/构建通过；整分支审查0发现/Ready to merge Yes；真实本地与正式构建浏览器覆盖关键流程。runtime一项HTTP仅适配自有Redis端口，其余断言不变。

未合并/推送/发布/部署。未声明nativeIME、Windows、外部模型provider或真实多人压力已验收。

验收主入口：agentwiki/docs/verification/document-workspace-20261006/acceptance.md
