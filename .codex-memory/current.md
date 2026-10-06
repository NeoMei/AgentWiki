# 当前目标

- OpenKnowledge借鉴的文档工作区两轮优化已完成，保留本地待集成分支。

# 范围 / 不做

- 统一读写画布、大纲、目录、手工工具、草稿恢复、精确Agent候选及个人批注、提案差异；第二轮补充聚焦差异与笔记队列操作。
- 无生产变更、合并、push、发布或部署；不复制GPL源码，不引入CRDT/schema迁移。

# 当前状态

- 工作树 /Users/neomei/.codex/worktrees/document-workspace/AgentWiki （尾空格），分支codex/document-workspace；第二轮最终产品b8c2ddf7，基线28e07dbd。后续仅验收及项目交接文档。
- 两项任务独立审查、最终整分支审查及唯一P3小修复定向复审完成，未关闭finding0。第二轮131套/1865客户端测试通过，最终修复128项定向测试通过；全仓typecheck、lint0errors（3条既有server警告）与client build通过。
- 真实IAB桌面和390px：聚焦长文差异、接受/精确撤销，笔记添加/筛选/明确两批发送/部分及完整接受/重开完成。Agent输出为本地模拟。所有本轮临时服务/schema/认证材料清理已独立复核。
- 第一轮更广范围6243通过/6skip见既有验收，不作为本轮新执行。Tiptap3.31.4语料字节保持1/17，未替换CodeMirror；线上0.12.12/LocalSync0.11.0未改。

# 稳定约束

- Git显式work-tree，勿改core.worktree。身份/Space/page缓存隔离，expectedUpdatedAt/treeRevision不放宽。
- 单画布读写互斥、一份Markdown源。Agent生成只进候选，显式接受才进本机草稿，正式Save另行版本校验。
- 个人笔记是本机私人数据；发送不等于解决，歧义保持待审。精确上下文变化会保守禁用；编辑器撤销不自动回滚笔记状态，保留显式重开。
- 后续子代理按用户要求继承当前p5c07ff通道，fork_turns=all且省略model/effort覆盖，并核验实际turn_context；不使用裸模型回退。

# 关键索引

- .codex-memory/tasks/archive/document-workspace-polish-20261006/brief.md
- agentwiki/docs/verification/document-workspace-polish-20261006/acceptance.md
- agentwiki/docs/verification/document-workspace-polish-20261006/reviews/scoped-final-review.md
- agentwiki/docs/superpowers/plans/2026-10-06-document-workspace-polish.md
- agentwiki/docs/verification/document-workspace-20261006/acceptance.md

# 风险 / 下一步

- 分支尚未集成或发布；后续按用户明确意图处理。
- 原生IME、Windows、外部provider和真实多人压力未验；本机笔记不跨设备。首屏JS547266/550000，保留预算门槛。
- 最终审查、浏览器截图及环境清理证据已归档；不保留临时认证材料。
