# 决策

## 2026-08-25

- 采用运行向导内完整闭环，而不是跳转 Agent 管理页面。
- 采用前端编排既有 API，不新增无法跨 PostgreSQL 与 Redis 原子化的聚合接口。
- 新建 Agent 默认授予 Editor，可由用户明确选择 Publisher。
- 若没有当前 Space 有效连接，在向导内生成并检测 MCP 一次性接入指令。
- `AgentGrant.role` 保持唯一权限事实；Agent 不获得人类审核权。
- Editor 可以启动协作，但不能管理 Agent Grant；准备入口必须按权限呈现。
- 每次只自动填入当前 Role Slot，不批量映射全部角色。
- 每个 Role Slot 提供上下文化准备入口；空状态主按钮指向第一个未映射的必需 Role Slot。
- 对齐 Local Sync installation 与协作/Grant 端点的 Super Admin 规则，并以服务端测试约束；不新增聚合 API。
- 尚未接入的 Agent 可先映射和启动，但映射与确认步骤必须持续明确提示连接状态。
- durable preparation progress 独立于 React，固定 Agent identity、Space、role、来源和最早未完成阶段；详情检查失败后的重试不得重复已完成 Grant，创建失败且未知 Agent identity 时不生成 progress。
- Dialog 必须可见提升并锁定已创建 Agent，不能只用隐藏 ref 保存；授权相关 403 统一通过父级 authorization-loss 回调 fail closed。
- 剪贴板写入 Promise 结算后必须同时重验 lifecycle generation 与 instruction expiry，过期状态优先于 copied/copyFailed。
- `SpaceService.listMembers` 的 `agent.connected` 是连接状态权威事实；向导必须从它重建本地 pending 状态，并仅在仍有 pending 绑定时每 3 秒轮询。
- 任何权威刷新都必须受 route identity、mutation epoch 与 request sequence 约束；跨 Space/模板或较旧请求不得覆盖新状态。
- 直接选择未连接 Agent 必须显示 pending 提示；Agent 资格变化必须剪枝绑定，并将 review/start 安全退回映射步骤。
- Agent 创建重试使用稳定 UI 幂等键和确定性 owner-scoped Agent ID；创建与审计必须同事务，严格 replay，失败不得留下半完成记录。
- 准备 403 后 Owner/Admin 指引必须跨后续成功轮询保持，所有准备 mutation 入口 fail closed；HMR 重载不作为生产状态合同。
- 弹窗关闭时若 opener 与 fallback DOM 同批替换，必须在 microtask 中读取当前 fallback ref 后恢复焦点，不能保存渲染时 DOM 快照。
- 真实 DB 测试只有在 `DATABASE_URL === COLLABORATION_TEST_DATABASE_URL`、数据库名含 `test` 且 schema 为随机 `collaboration_test_*` 时才允许写入。
