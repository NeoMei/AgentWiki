# 当前目标

彻查模板预览下拉框再次出现系统样式的问题，统一全部产品选择控件并加入防回归门禁；完成真实UI验证后沿用会话中的发布授权。

# 范围 / 不做

客户端56处选择控件、28个业务文件及共享样式/自动验证。无服务端业务、数据库、依赖或用户内容修改；Local Sync0.13.4与protocol0.6.1不变，不发布npm。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/template-preview-custom/AgentWiki `（尾空格），分支 `codex/unified-select-audit`，基线2f653b97；主检出用户改动保留。
- 根因：先前只修复Agent设置的局部样式，模板新控件仍为裸select且另加深色outline。NativeSelect集中箭头、边框、尺寸和焦点，业务样式仅保留布局。
- 56/56处事件、属性和选项经独立AST审查保持；2759客户端测试、TypeScript、lint、5项规则测试及生产构建通过。
- 本地6条浏览器回归与跨组件实际渲染验收进行中。尚未发布本次修复。
- 当前生产仍为v0.12.54，冻结e067fa37，上个版本模板预览/自定义入口的生产11项已通过。

# 稳定约束

Git 在对应工作树 cwd 下显式 --work-tree 指向带尾空格路径，不指定 common --git-dir。不要并行运行会清理同一dist的build与依赖dist的验证。生产发布前完成固定候选测试与配套备份；发布后核对源码、资源、服务、健康及实际浏览器。

# 关键索引

- .codex-memory/tasks/active/unified-select-audit-20261020/{brief,decisions,refs}.md
- .codex-memory/spec/component-reuse.md
- /private/tmp/agentwiki-select-audit-20261020/
- agentwiki/docs/releases-v0.12.54.md

# 风险 / 下一步

完成桌面/手机、长文本/禁用、键盘焦点及高对比浏览器验收，再冻结v0.12.55执行发布门禁、备份、部署与生产回验。不得把本地fixture测试称作生产验收。
