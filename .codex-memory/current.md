# 当前目标

- OpenKnowledge借鉴的文档工作区优化及本轮阅读/编辑全页布局均已完成本地实现与验收。

# 范围 / 不做

- 已完成单画布读写、目录导航/定位、大纲及协作面板偏好、候选/私人笔记、Space授权链接搜索、保真GFM表格；本轮增加全宽白色文档区域、统一边距/字号、面板占位和手机路径优化。
- 未合并、push、发布或部署。未复制GPL源码、未换编辑器或引入新依赖/CRDT/schema。全功能WYSIWYG、图片属性及完整嵌套列表块UI仍为后续范围。

# 当前状态

- 工作树 /Users/neomei/.codex/worktrees/document-workspace/AgentWiki （尾空格），分支codex/document-workspace。本轮基线fa6e8dbd，产品1991cc89；前三轮产品213a2aae/b8c2ddf7等保留。原主目录未改，既有untracked research目录保留。
- 本轮7生产文件+4spec；fresh实现、独立review及root整合/浏览器验收完成，实际p5c07ff/gpt-6-astra/ultra。实机发现的协作面板挡toolbar与390路径挤压已修复，独立复审无未关闭问题。
- 最终135client suites/2016tests通过；client生产build含tsc、局部eslint、diff check通过。首屏548658/550000（+82B），预算未放宽。
- 最终真实API/生产构建1280/1600/390验收通过。编辑选区保持，输入后Undo的全文严格等于原文，API两页title/content/updatedAt未变，全程无Save。11:54:08Z独立清理通过，浏览器退出/关tab/reset。
- 线上仍0.12.12/LocalSync0.11.0未改。Tiptap语料字节保持1/17，继续CodeMirror单源。

# 稳定约束

- Git显式work-tree，勿改core.worktree；身份/Space/page隔离及expectedUpdatedAt/treeRevision保护不放宽。
- 单画布读写互斥、一份Markdown源；Agent只生成候选，显式接受入本机草稿，正式Save另行校验。
- 个人笔记本机私人，发送不等于解决；原文歧义保持待审，编辑撤销不自动回滚笔记状态。
- CRLF/混合行尾与CM原文不一致时表格UI回退源码；helper字节保真不等于生产可视编辑支持。
- 使用用户指定p5c07ff通道，核验actual turn_context，不使用裸模型回退。浏览器/测试回执与正式部署是不同事实。

# 关键索引

- .codex-memory/tasks/archive/document-fullpage-layout-20261006/brief.md
- /tmp/agentwiki-layout-20261006/acceptance.md（本轮截图、review、构建/测试及清理回执均在此目录）
- .codex-memory/tasks/archive/document-workspace-completion-20261006/brief.md
- agentwiki/docs/verification/document-workspace-completion-20261006/acceptance.md
- agentwiki/docs/research/openknowledge-20261006/目标覆盖矩阵.md
- agentwiki/docs/verification/document-workspace-polish-20261006/acceptance.md
- agentwiki/docs/verification/document-workspace-20261006/acceptance.md

# 风险 / 下一步

- 本分支未集成或部署，按用户后续明确意图处理。
- 原生IME、Windows、外部provider、真实多人压力未验；本机笔记不跨设备。保持现有bundle预算及已审查Mermaid parser例外。
