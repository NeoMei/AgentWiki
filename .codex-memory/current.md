# 当前目标

- 文档体验第二轮优化：候选差异更易审阅、个人笔记队列与批量选择更顺手。

# 范围 / 不做

- 统一读写画布、大纲、目录、手工工具、草稿恢复、精确Agent候选及个人批注、提案差异。
- 本轮无生产变更、合并、push、发布或部署；不复制GPL源码，不引入CRDT/schema迁移。

# 当前状态

- 第二轮从28e07dbd继续，状态为实施中；活跃任务document-workspace-polish-20261006。下面为第一轮已验证基线。

- 工作树 /Users/neomei/.codex/worktrees/document-workspace/AgentWiki （尾空格），分支codex/document-workspace，产品候选897aa3f8，基线c7b89567。后续提交仅验收与项目交接文档。
- 六项计划、逐项独立复审、整分支审查均完成，最终Ready to merge Yes/0finding。6243通过/6skip，全仓typecheck/lint0errors/build通过。实际本地及生产构建浏览器关键流程通过。
- Tiptap3.31.4仅1/17语料字节保持，未替换当前CodeMirror。线上0.12.12/LocalSync0.11.0未改。

# 稳定约束

- Git显式work-tree，勿改core.worktree。身份/Space/page缓存隔离，expectedUpdatedAt/treeRevision不放宽。
- 单画布读写互斥、一份Markdown源。Agent生成只进候选，显式接受才进本机草稿，正式Save另行版本校验。
- 个人笔记是本机私人数据；发送不等于解决，歧义保持待审。

# 关键索引

- .codex-memory/tasks/active/document-workspace-polish-20261006/brief.md

- .codex-memory/tasks/archive/document-workspace-20261006/brief.md
- agentwiki/docs/verification/document-workspace-20261006/acceptance.md
- agentwiki/docs/verification/document-workspace-20261006/reviews/whole-branch-review.md
- agentwiki/docs/superpowers/plans/2026-10-06-document-workspace.md

# 风险 / 下一步

- 分支尚未集成或发布；后续按用户明确意图处理。
- 原生IME、Windows、外部provider和真实多人压力未验；本机笔记不跨设备。首屏JS547266/550000，保留预算门槛。
- 临时服务清理记录收敛于acceptance.md；不保留临时认证材料。
