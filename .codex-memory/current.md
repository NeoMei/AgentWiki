# 当前目标

模板内容预览与自定义模板管理/使用入口两项反馈已完成独立本地候选、验证与审查。生产最新仍为 v0.12.53。

# 范围 / 不做

只修复新建内容与模板管理的客户端流程，不更改服务端权限、数据库模型、既有模板版本或用户内容。无发布、部署或 npm 变更。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/template-preview-custom/AgentWiki `（尾空格），分支 `codex/template-preview-custom`，基线 f13c5f0a。
- 预览显示真实正文缩略图、页面组切页和放大只读内容，处理错误/空内容/旧响应/版本漂移。
- 新建页左侧自定义模板，管理员顶部管理入口；管理页从页面创建和直接使用，保留folder目的地及编辑/版本/归档/恢复。
- 生产构建通过；首屏JS 547823/550000字节。客户端2756项、浏览器5条、ESLint及独立复审通过。回执见关键索引。
- 生产 v0.12.53 内嵌Agent自动聊天/目录访问/下拉框样式的发布状态保持；旧发布回执见 docs/releases-v0.12.53.md。

# 稳定约束

Git 在对应工作树 cwd 下显式 --work-tree 指向带尾空格路径，不指定 common --git-dir。保留主检出用户改动。不要并行运行会清理同一 dist 的 build 与依赖 dist 的验证。发布以实时生产源码核对为准。

# 关键索引

- .codex-memory/tasks/active/template-preview-custom-20261019/{brief,decisions,refs}.md
- agentwiki/docs/verification/template-preview-custom-20261019/acceptance.md
- agentwiki/docs/verification/template-preview-custom-20261019/README.md
- agentwiki/docs/releases-v0.12.53.md
- agentwiki/docs/verification/agent-auto-release-20261019/release.json

# 风险 / 下一步

本轮仅本地修复。浏览器验收使用真实产品组件和本地内存HTTP API，不能等同线上权限、数据库或生产发布验收。后续发布需另做版本、备份、部署与线上回读。
