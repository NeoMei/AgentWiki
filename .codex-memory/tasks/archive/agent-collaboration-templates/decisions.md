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
19. 人工驳回采用任务 generation 和因果子图失效；旧代记录保留但标记 superseded，不能释放依赖或完成运行。
20. 人工改派保持 Role Binding 快照不变，但当前任务负责人同样构成 join 资格；改派必须校验新 Agent、废止旧租约并生成恢复指令。
21. 运行状态先处理终态/paused，再看可执行 Agent 工作，只有人类审核是唯一动作时才 waiting_review。
22. `any` 是提前释放而非赢家通吃，其余未跳过上游仍参与运行完成判定；必需 Artifact 不允许依赖不安全的 any 提前释放。
23. 写操作幂等作用域固定为 run、actor、operation 和 key，并校验 request hash/target；租约明文只可在授权精确重放时确定性重建。
24. JSON Artifact 使用严格判别联合；JSON Schema 只支持受限 2020-12 子集，由直接依赖 Ajv 8.18.0 严格校验且禁止远程引用。
25. PostgreSQL 集成测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 和随机 `collaboration_test_*` schema，不直接迁移或清理任意 DATABASE_URL/public。
26. 统一角色已经随 local-sync/onboarding 0.5.1 发布并完成生产验证；协作从该基线开发，完成后把 local-sync、server/client、网关和 onboarding 统一提升到 0.6.0，sync-protocol 保持独立包 semver。
27. 真实 PostgreSQL 并发下，Prisma `P2010` 且 `meta.code=40001` 与 `P2034` 同属可重试序列化冲突；只在领取的有界三次重试内分类，不扩大为通用无界重试。
28. 自动化 API/Worker/MCP E2E 与真实 Codex/Claude Code/OpenCode 客户端验收是两个证据层级；后者未执行时必须标记 `BLOCKED`。
29. 同一 Artifact 的多个人工 Review 必须全部批准才能 accepted 并释放消费者；任一驳回必须失效同源 Review 分支的已消费子图。
30. 指定审核人必须是当前 Space 人类成员；如果全部指定审核人后续被移除，只允许 Owner/Admin 使用明确记录的恢复通道决策。
31. 看板历史必须逐页加载，待审 Artifact 必须按 ID 直接授权读取，不允许前端无上限扫描全历史。
32. 运行、模板和看板的异步请求必须绑定路由 scope 与单调 epoch；同一 scope 的旧响应也不得覆盖新状态。
33. 审核按钮权限由服务端基于实时人类成员、最低角色、指定审核人与 Owner/Admin 恢复规则计算 `Review.canDecide`；前端不得自行推导或扩大权限。
34. 启动向导只要一个 Agent 绑定多个角色就必须显式确认自审风险；发生版本冲突刷新时必须以服务器返回的当前运行 `roleBindings` 重新检查，旧表单确认不能绕过。
35. 本地发行候选只有在四轮审查、完整自动化门禁、真实 PostgreSQL/API/MCP、双 tarball 空目录安装和真实浏览器移动端交互全部通过后才可归档；这不自动授权 push、npm 发布或生产部署。
