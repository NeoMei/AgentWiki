<!-- codex-memory:template=current:v1 -->

# 当前目标

- Agent 协作运行“映射 Agent”站内准备实现已完成本地全门禁与真实端到端验收；当前保持发布前 active，等待独立授权后才可 push/发布/部署。

# 范围 / 不做

- 范围包含已有/新建 Agent、paused 恢复、当前 Space Editor/Publisher 授权、MCP 一次性接入指令、接入检测和当前 Role Slot 自动选择。
- 不自动启动外部 Agent，不修改协作调度/模板/状态机，不批量映射全部角色。
- 继续复用 `AgentGrant.role` 单一权限事实；Agent 不获得人类审核权限，不引入第二套 Credential scopes 或授权入口。
- 未经独立授权不推送、不发布 npm、不部署生产。

# 当前状态

- Tasks 1–6 已在本地完成：向导内创建/恢复 Agent、Grant、一次性接入、自动检测、当前 Slot 映射、待接入警告、权限边界、并发收敛和安全数据库验收均已覆盖。
- 最终状态收敛修复提交为 `7418b4e`：服务端返回权威 `agent.connected`，前端重建/轮询连接事实并处理跨路由、并发刷新、资格变化与 draft/update/validate/start 竞争；Agent 创建使用稳定幂等键、确定性 owner-scoped identity 与创建/审计同事务。
- 真实 Browser 发现的唯一产品缺陷是准备完成后入口随弹窗一同移除时焦点落到 `body`；已在 `ab49860` 以实时 fallback ref + microtask 修复。`9abcdcc`、`a6e0bbe`、`2392223` 分别补齐异步焦点、403 跨轮询提示和 fallback DOM 同批替换的回归合同。
- 最终全量门禁：lint、4 个 workspace typecheck、5 个 workspace build 均通过；全仓 2,358 个测试通过、54 个既有环境依赖测试跳过、0 失败。构建仅有既有 Vite 大分块建议。
- 隔离 PostgreSQL 验收通过：schema/migration 2/2、协作 workflow 10/10、Agent 并发幂等/审计回滚 1/1；普通 DB 测试在未配置双重安全变量时按设计跳过。
- 桌面与 390×844 Browser 验收通过：空状态创建/授权/Connect later、外部 connected 自动清除、直接选择 pending、真实 403 后跨 4.7 秒轮询持续 Owner/Admin 指引、焦点 fallback、无横向溢出；console error/warn 均为 0。曾观察到的提示消失由 Vite HMR 精确解释，稳定重验未复现，不计产品缺陷。
- 最终清理零残留：Browser 测试页关闭，API/Vite 停止，3000/5173 无监听，四类 Redis 临时键为 0，全部 `collaboration_test_*` schema 为 0，临时 health 文件不存在。
- 独立最终代码审查结论为 Critical 0 / Important 0 / Minor 0。
- 2026-08-25 再次执行发布级复审：固定范围安全审查 36/36、0 finding/0 deferred；隔离 DB 2/2 + 10/10 + 1/1；新的真实 Browser 从空 Agent 映射一直启动到 Run 看板，桌面/390px/console/清理均通过。末轮聚焦测试发现并修复 2 个测试 fixture 问题（缺失安装响应 mock、固定时刻凭证过期），生产代码未改；52/52、前端聚焦 145/145、服务端聚焦 117/117 后再次全仓门禁 2,358 passed / 54 skipped / 0 failed。
- 本地实现已验证；push、npm 发布和生产发布未获授权，未执行。
- 上一版协作发布基线仍为本地/GitHub/生产 `0.6.1` 与 Sync Protocol `0.3.0`。

# 稳定约束

- `AgentGrant.role` 是唯一持久化权限事实；Credential 只保存身份和生命周期，权限从当前 Grant 实时派生。
- 普通 Agent 角色仅为 `reader | editor | publisher`，任何 Agent 都没有 `review:decide`；审核权由服务端实时计算 `Review.canDecide`。
- 协作运行保存不可变模板快照；人工审核只能由人类完成；指定审核人失效时只允许 Owner/Admin 走审计恢复通道。
- PostgreSQL 协作测试只允许专用 `COLLABORATION_TEST_DATABASE_URL` 与随机 `collaboration_test_*` schema，禁止迁移或清理 `public`。
- Sync Protocol 独立 semver；当前修订发布顺序必须是 protocol `0.3.0` → registry 验证 → local-sync `0.6.1` → 弃用损坏的 `0.6.0`。
- Obsidian 连接从“使用指南”内部进入；全局导航与个人菜单不再提供独立“连接 Obsidian”目的地，`/guide` 在 Obsidian 子路由上保持激活。

# 关键索引

- 当前 Agent 准备设计：`agentwiki/docs/superpowers/specs/2026-08-25-collaboration-agent-preparation-design.md`
- 当前 Agent 准备计划：`agentwiki/docs/superpowers/plans/2026-08-25-collaboration-agent-preparation-plan.md`
- 本地最终验收：`agentwiki/docs/testing/collaboration-agent-preparation-acceptance.md`
- 当前活跃任务：`.codex-memory/tasks/active/collaboration-agent-preparation/`
- 协作模板设计：`agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- 协作模板实施计划：`agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- 最终发行审查计划：`docs/superpowers/plans/2026-08-24-collaboration-release-final-audit.md`
- 真实客户端与最终门禁：`agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- 已归档协作任务：`.codex-memory/tasks/archive/agent-collaboration-templates/`
- 已归档发布收口任务：`.codex-memory/tasks/archive/collaboration-release-finalization-2026-08-24/`
- 既有安全/发布任务：`.codex-memory/tasks/archive/comprehensive-security-reliability-audit-2026-08-23/`

# 风险 / 下一步

- 待用户单独授权后，才能 push 当前分支、执行发布或生产部署；本任务因此保持 active。
- 任何生产发布都需重新完成目标确认、备份、部署门禁和在线 Browser 验收；不得把本地验收当作已发布证据。
