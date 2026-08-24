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
