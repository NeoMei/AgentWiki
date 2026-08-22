# 决策

1. 外部 Agent 通过 MCP 主动加入、领取和回传；AgentWiki 不托管模型。
2. MVP 提供五个内置模板的复制配置，不做通用拖拽编辑器。
3. 每个 Agent 在开始或人工审核恢复后只需唤醒一次，并循环到安全退出点。
4. AgentWiki 保存 Markdown/JSON、证据和外部引用，不建设通用文件仓库。
5. 组件为 Agent 任务、顺序 Todo、依赖/并行、人工审核和结果交接/汇总。
6. 模板使用角色槽位，运行时绑定具体 Agent；一个任务只有一个主责 Agent。
7. 人工审核只能由人类完成。
8. 失败使用租约、自动重试和人工接管，不做动态竞领和自动改派。
9. 新建独立协作控制面，复用确定性编排经验，但不扩展 Local Knowledge Recipe 的领域边界。
10. 模板启动时冻结快照；模板后续修改不影响运行。
11. Todo 是任务内有序清单，依赖是节点之间的边，并行由多个 ready 节点自然产生。
12. 协作 scopes 由统一 `reader | editor | publisher` 角色策略派生，不重新暴露 scope 复选框。
13. 人工审核点使 Agent 安全退出；审核后 UI 生成恢复指令，MVP 不承诺远程自动唤醒。
14. 未经单独授权不 push、不发布 npm、不部署生产。
15. 服务端新领域目录使用 `collaboration-workflows`，与现有页面实时协作 `core/collaboration` 分离；后者只承担已提交状态的刷新通知。
16. 服务端 MCP 使用 canonical `collaboration_*`，本地统一网关向 Agent 暴露带精确 schema 的 `wiki_collaboration_*`。
17. 幂等领取的租约令牌使用现有 `JWT_SECRET` 做域隔离 HMAC 可重建，数据库仍只保存 token hash；同一 Agent 在同一运行最多一个活跃尝试。
18. 系统模板以非空 `scopeKey=system` 与 slug 唯一，Space 模板以 `scopeKey=spaceId` 唯一，避免 PostgreSQL nullable 唯一键无法保护系统 seed。
