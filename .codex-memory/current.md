# 当前目标

- 实施统一 Agent 会话侧栏第一阶段：阅读/编辑共用持久对话、跨文档连续问答、显式引用及私人笔记、候选审阅。同步定义本机 ACP adapter 接口。

# 范围 / 不做

- 用户已确认推进。复用 AssistTask 队列新增 AssistSession，不连接本机 ACP Agent，不做 Follow Mode/多文档原子修改/图片文件夹上下文。
- 不 push、merge、发布或部署，不改原主目录，不新增依赖或更换编辑器。

# 当前状态

- 工作树 /Users/neomei/.codex/worktrees/document-workspace/AgentWiki （尾空格），codex/document-workspace，基线 ee9348839924fd7566ff3b67fa72beb6090a77ea。
- 只读前后端和 runtime 调研完成，设计/计划已固定；新功能代码尚未实现。Task 1 后端、Task 2 前端、Task 3 整合验收顺序推进。
- 上一轮全页布局 1991cc89 已独立审查和生产构建实机验收；2016 client tests，初始 JS 548658/550000。环境已清理。
- 线上仍0.12.12/LocalSync0.11.0未改。

# 稳定约束

- Git显式work-tree，不改core.worktree；用户指定p5c07ff，fresh实施与独立审查。
- user/Space/page隔离、live权限、expectedUpdatedAt/treeRevision保护不放宽；引用和历史来源在执行及返回时重新鉴权。
- 单Markdown源，Agent候选显式接受到草稿，正式Save另行校验；本机revision不是持久版本。
- 私人笔记本机保存，显式发送，发送不等于解决。550000 JS预算不增加。
- 数据迁移先独立审查，后更新已批准corpus hash，不绕过数据库保护。

# 关键索引

- .codex-memory/tasks/active/agent-sessions-20261006/brief.md
- agentwiki/docs/superpowers/specs/2026-10-06-agent-sessions.md
- agentwiki/docs/superpowers/plans/2026-10-06-agent-sessions.md
- .superpowers/sdd/2026-10-06-agent-sessions/progress.md
- /tmp/agentwiki-sessions-20261006/
- .codex-memory/tasks/archive/document-fullpage-layout-20261006/brief.md

# 风险 / 下一步

- 后端会话、取消、授权、进度与schema需先完成和独立审查；前端须保留候选/笔记保护并控制首屏预算。
- 本轮实际模型接入与fixture provider验收分开记录；不宣传已经完成本机ACP。
