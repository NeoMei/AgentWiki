# 当前目标

- 用户连续报告的单行选区和编辑态图片问题已本地修复、验证并独立复审；尚未推送或部署。

# 范围 / 不做

- Web 0.12.25 / Local Sync 0.12.0 / protocol 0.6.1；目标 Space cmv6biedu005okoisb9fgp64y 的 5 个目录、17 篇模板。
- 历史缺陷与人工验收不因本次发布而批量关闭。

# 当前状态

- 图片预览/点击展开/离开恢复完成；支持常用单行Markdown及Wiki/相对附件，32K/256候选预算避免逐键全文解析。最终client144files/2325pass、build/lint/tsc与独立复审通过；真实Chrome默认首图/点击/Enter/改URL撤销/失败fallback/两类Blob/窄屏/选区回归通过。
- 分支 `codex/editor-single-line-selection` 基于 `1bbb428e`：不透明活动行背景遮住 CodeMirror 选区，改为 2% 黑色透明背景。生产原案复现、本地正反拖选/键盘/跨行/软折行/加粗范围/失焦恢复通过；client build 与独立审查通过。此次修复尚未推送或部署。
- 正式部署源码 48781e5b192101a2d122dd143048d983bca8a29b；GitHub v0.12.25 与 npm 0.12.0 已发布。7,114 pass / 6 skip / 0 fail，typecheck/lint/build 与独立审查通过。
- 生产迁移、1,252 文件、3 服务、5 health、32 烟测已验；原 71 凭据、482 Grant 稳定字段保留；配套备份可追溯。
- 用户明确授权目标空间 Publisher 限定范围自动发布，空间策略已保存；Agent 原已允许。原连接与凭据保留，3 授权 Space 实读通过。
- 15 页原位更新 + 2 页新建，最终 17 页标题/正文/目录/Agent 审计回读一致；110 内链有效。模板30功能/12需求/11任务/18用例/6报告/12反馈/7日志，42验收条件。

# 稳定约束

- Agent 身份一次接入，按目标实时 Grant 授权，不再索取逐 Space 接入码；不得跨身份回退。
- 文档正式读写用 MCP，发布与最终回读分开留证；空值与历史状态不得伪造。
- 工作树路径有尾空格；Git 显式 --work-tree，保留主检出用户工作。

# 关键索引

- .codex-memory/tasks/active/editor-live-preview-20261014/{brief,decisions,refs}.md
- agentwiki/docs/verification/editor-images-20261014/status.md
- agentwiki/docs/verification/editor-single-line-selection-20261014/status.md
- .codex-memory/tasks/archive/agent-identity-space-auth-20261013/{brief,decisions,refs}.md
- agentwiki/docs/verification/agent-identity-space-auth-20261014/status.md
- agentwiki/docs/verification/agent-identity-space-auth-20261014/template-final-publication-receipt.json
- 项目首页：https://agentwiki.quukk.com/pages/f285b898-65ba-4938-8616-e9a0b8f575f5

# 风险 / 下一步

- 17 篇项目模板交付已完成。两项编辑器修复本地通过，尚未推送/发布；上线后需生产编辑模式回验。
- 多行图片、列表4空格续行图片与超候选预算保守保留完整源码；附件浏览器验证使用本地模拟API，不是生产鉴权验收。
- 当前旧聊天 MCP 进程未热重载；本机配置已升级，新启动官方0.12.0网关已实测，原连接不变。
- 批量 MCP 调用应节流（本次至少3.25秒/调用）；原429已通过核对保存结果恢复。侧栏保留既有sortOrder，首页按流程提供导航；旧目录候选仍pending但已被正式发布替代。
