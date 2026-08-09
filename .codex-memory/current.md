<!-- codex-memory:template=current:v1 -->

# 当前目标

- AgentWiki 0.2.6 上线收尾：代码、测试、npm、GitHub 与生产服务保持同一版本。

# 范围 / 不做

- 当前产品栈：React/Vite + NestJS + Prisma/PostgreSQL；生产采用源码直部署和用户级 systemd。
- 不恢复已退役的外部 Wiki 编译器、公开 Agent 任意注册、服务端读取本地路径或上传原始代码/二进制/凭据。
- Agent 破坏性操作仍通过 ChangeSet 人工审核；只有明确授权且符合 Space 策略的普通写操作可自动发布。

# 当前状态

- 2026-08-10 完成 0.2.6 代码与本地上线门禁：全量代码图谱 3861 节点 / 10135 边，架构、符号、源码与调用链均可查询。
- 零配置本地知识链路已真实验证：codebase-memory 扫描、Orchestrator 整理、非空 provenance Bundle、预览确认、人工审核发布。
- 双向同步已真实验证：两个本地工作区 Snapshot/Delta Pull/Push，页面、共享记忆、关系、冲突阻断及三类审批删除均通过。
- Space Agent 成员桌面/移动端浏览器验收已通过；全站 3 个公开、16 个登录后、6 个移动端关键路由巡检通过。
- 门禁：runtime 61、server 369、client 124、local-sync 173，合计 727 项自动测试通过；typecheck、lint、build、peer check 通过，生产依赖 0 high / 0 critical。
- Codex Security 扫描完成：修复前快照发现 16 项，当前工作树均已修复并回归验证。
- GitHub `master` 已更新到 `caba0a4`，并已发布 `v0.2.6` 标签。
- 详细证据：`agentwiki/docs/verification/production-readiness-0.2.6.md`。

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
- 测试报告：`agentwiki/docs/verification/production-readiness-0.2.6.md`

# 风险 / 下一步

- npm 0.2.6 已进入公开暂存区，正等待 npm 网站 WebAuthn 批准；生产部署还需服务器免密 SSH 访问。
