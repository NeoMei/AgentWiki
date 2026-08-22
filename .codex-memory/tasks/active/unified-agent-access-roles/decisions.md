# 决策

- 采用连接授权包方案：一次选择 `Space + role`，兑换时原子创建/更新 Grant 与 Credential。
- Agent 角色统一命名为 `reader`、`editor`、`publisher`。
- Grant 和 Credential 都记录角色及服务端派生 scopes，运行时继续取两者交集。
- `reader` 只读；`editor` 可写但默认走人工审核；`publisher` 增加 Memory 和 scoped auto-publish 能力。
- `review:decide` 永远不属于 Agent 角色。
- Publisher 不修改 Space Policy，自动发布仍需完整治理条件同时满足。
- 普通界面和新接口不再接受逐项自定义 scopes。
- 不考虑旧版本客户端和旧版本权限数据兼容。
