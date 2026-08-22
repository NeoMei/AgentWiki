# 决策

- 采用连接授权包方案：一次选择 `Space + role`，兑换时原子创建/更新 Grant 与 Credential。
- Agent 角色统一命名为 `reader`、`editor`、`publisher`。
- Grant 和 Credential 都记录角色及服务端派生 scopes，运行时继续取两者交集。
- `reader` 只读；`editor` 可写但默认走人工审核；`publisher` 增加 Memory 和 scoped auto-publish 能力。
- `review:decide` 永远不属于 Agent 角色。
- Publisher 不修改 Space Policy，自动发布仍需完整治理条件同时满足。
- 普通界面和新接口不再接受逐项自定义 scopes。
- 不考虑旧版本客户端和旧版本权限数据兼容。
- 新 Local Sync/onboarding 协议版本为 0.5.0，服务端不接受本流程的 0.4.0 请求。
- Prisma 迁移不按旧 scopes 猜测角色；现有 Agent Grant/Credential 统一降级为 reader，用户通过新连接重新授权。
- `POST/PATCH /agents` 不再接受 `approvalMode`；该值仅作为 Publisher 由服务端启用的内部治理状态和只读诊断。
- root 版本、env 样例、Compose、README、E2E 和发布契约统一到 0.5.0，防止服务端已升级但部署面仍广播 0.4.0。
- 发布和生产迁移必须先验证 PostgreSQL custom-format 与应用回滚备份；0.5.0 无 schema-only 回滚。
- 本地验证结束后不自动 push、npm publish、deploy 或改动真实 OpenCode 连接。
- 新角色导出属于公开 `@neomei/agentwiki-sync-protocol@0.2.0`；发布时必须先发布该包，再发布精确依赖它的 local-sync 0.5.0。
- npm 发布前必须把两个候选 tgz 安装到空目录并启动已安装 CLI；两包上传后还要对 registry 版本重做同一检查。
