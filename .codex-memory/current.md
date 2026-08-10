<!-- codex-memory:template=current:v1 -->

# 当前目标

- 按已确认实施计划实现 Agent 自助接入 0.3.0：网页 Device Auth、NDJSON 填空、单一 gateway MCP，以及首次本地扫描和同步。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核；只有明确授权且符合 Space 策略的普通写操作可自动发布。

# 当前状态

- 2026-08-10 完成 0.2.9 代码与本地上线门禁：全量代码图谱 3883 节点 / 10151 边，架构、符号、源码与调用链均可查询。
- 零配置本地知识链路已真实验证：原生 codebase-memory 直接执行；Microsoft MarkItDown 0.1.6 由私有 Python 3.10+ venv 管理，PDF 转换、运行时复用和校验通过。
- 双向同步已真实验证：两个本地工作区 Snapshot/Delta Pull/Push，页面、共享记忆、关系、冲突阻断及三类审批删除均通过。
- Space Agent 成员桌面/移动端浏览器验收已通过；全站 3 个公开、16 个登录后、6 个移动端关键路由已巡检。
- 门禁：runtime 65、server 369、client 124、local-sync 181，合计 739 项自动测试通过；typecheck、lint、build、peer check 通过，生产依赖 0 high / 0 critical / 0 low，3 moderate 均不可达。
- npm `@neomei/agentwiki-local-sync` 公网 `latest=0.2.9`，过期 0.2.6/0.2.7/0.2.8 暂存项已拒绝。
- 生产已备份并部署 0.2.9；API、Worker、Frontend 均为 active，健康检查全绿，onboarding 安装命令包含 `--orchestrator`。
- 生产受控验证已通过：API smoke 18 项、3 个公开/16 个登录后/6 个移动端 UI 路由、Space Agent 成员桌面/移动端。
- 生产 Nginx 的 `/socket.io/` 误路由已修复，公网 WebSocket 握手由 400 恢复为 101，并加入配置契约测试。
- 详细证据：`agentwiki/docs/verification/production-readiness-0.2.9.md`。
- Agent 自助接入 0.3.0 设计与实施计划均已确认落盘；Task 1-3 已完成，事务化 bootstrap、执行 fencing、模糊 Redis 写入恢复和每 device session 独立 Agent 已通过 486 项服务端测试与人工复审。
- Task 4 网页 Device Auth 前端已实现：公共授权页、登录/注册安全回跳、401 过期会话恢复、唯一 0.3.0 命令、同账号多 Agent 说明均已完成；160 项前端测试、lint、桌面/390px 移动端真实浏览器验收通过，待聚焦提交。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成，只同步确认后的知识 Bundle。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须生成提案并由用户确认，禁止静默覆盖。
- Markdown 编辑器保持单界面阅读/实时预览编辑状态，不恢复并排双栏。
- 发布流程固定为备份、迁移、部署、健康检查、受控 smoke 和版本核对。

# 关键索引

- 产品代码：`agentwiki/`
- 生产地址：https://agentwiki.quukk.com
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync
- 测试报告：`agentwiki/docs/verification/production-readiness-0.2.9.md`

# 风险 / 下一步

- 自助接入 Task 1-3 已完成，Task 4 正在提交收尾，Task 5-11 尚待按计划实施；完整 0.3.0 流程当前仍不得宣传为已上线。
- 0.3.0 采用破坏性简化，不为刚发布且尚无用户规模的 0.2.9 双 MCP、connect、旧工具名或旧状态实现兼容层。
- 生产依赖审计剩余 3 个不可达 moderate；只有未来引入 Nest SSE 或 `FileTypeValidator` 路径时才需重新评估。
