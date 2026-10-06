# 当前目标

- OpenKnowledge 参考的统一 Agent 会话侧栏第一阶段及混合批注 P2 修复，已在固定候选 f4325942 完成独立验收并归档。本期停止自动跟进。

# 范围 / 不做

- 阅读/编辑共享持久对话、跨文档上下文、显式引用及私人笔记、候选审阅；ACP 本期仅接口/能力契约。
- CodeWiki 不引入；其他 OpenKnowledge 建议仅研究，未授权扩展研发。
- 未 push、merge、发布或部署；不追加实现或部署，原主目录未改。

# 当前状态

- 工作树 `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki `（尾空格），分支 codex/document-workspace；固定产品 f4325942c53101e8c628cd68fc1b7f23f07ae5cd，验收交接 aff013bfd7507c3a0e2c2060bc607cc3f1fa28d3 仅文档。
- 原混合 Resolved/Awaiting-review 重生成 P2 经独立组件探针与真实浏览器路径关闭；规范/质量/集成审查 Approved。当前修复 427 定向检查及 tsc/lint/build 通过，JS 548914/550000。
- 新候选实际 UI A1–A6 通过：显式批注/引用、跨页历史、混合状态重生、3 次 Undo/Redo 逐字、显式 Save 后 API/DB 精确回读、1600/1280/390、断网输入保留、实际 Stop 及授权丢失清空。
- 独立运行时清理回执确认 schema/进程/凭据/端口清理及受保护 inventory 不变；浏览器退出并恢复网络/视口，测试 origin 本地笔记/偏好可能残留。
- 旧 server 2877/26 skip、client 全量 2091、13 HTTP/DB gate 属于各自历史候选；旧 13 gate 未在 f432 全量重跑，server dist 同 hash。本轮归档不宣称重新运行这些检查。

# 稳定约束

- Git 显式 work-tree，不改 core.worktree；用户指定 p5c07ff，fresh 实施与独立审查。
- user/Space/page 隔离与 live 权限、expectedUpdatedAt/treeRevision 不放宽；历史来源执行及返回均鉴权。
- 单 Markdown 源；候选显式接受到草稿，正式 Save 另行校验；Undo 不回退历史接受/笔记记录。
- 私人笔记本机保存、显式发送，发送不等于解决；JS 550000 预算不增加。
- 迁移先独立审查再更新批准 corpus hash，不绕过数据库保护。

# 关键索引

- .codex-memory/tasks/archive/agent-session-mixed-notes-20261007/brief.md
- .codex-memory/tasks/archive/agent-session-mixed-notes-20261007/acceptance.md
- .codex-memory/tasks/archive/agent-session-mixed-notes-20261007/acceptance-result.json
- .codex-memory/tasks/archive/agent-sessions-20261006/brief.md
- agentwiki/docs/superpowers/specs/2026-10-06-agent-sessions.md
- agentwiki/docs/superpowers/plans/2026-10-07-agent-session-mixed-notes.md

# 风险 / 下一步

- 无本期遗留验收项，不自动开启后续研发或部署；分支与工作树保留。
- 真实 provider 未验，确定性 CLI fixture 不证明模型质量；ACP 无完整本机接入/tools/permissions/FollowMode。
- 失权验收为隔离单 Space membership 注入，不是最后 owner 移除业务 API 验收；本地 SVG 图标未计入图片渲染验收。
- 单会话 100 轮，模型最近 10 个 completed 轮次/120000 字符；浏览器进程终止时在途私人批注绑定恢复不在本阶段承诺。
