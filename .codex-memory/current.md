<!-- codex-memory:template=current:v1 -->

# 当前目标

- AgentWiki 本地代码标准扫描已从 Codebase Memory 切换为 CodeGraph 扫描、AgentWiki 分析和派生知识同步。
- 第一阶段实现、多轮审查、npm 0.4.0、GitHub 与生产部署均已完成。

# 范围 / 不做

- CodeGraph 独立安装、升级并维护 `.codegraph/`；AgentWiki 仅通过能力协商和 `agentwiki-code-snapshot@1` 消费扫描结果，不绑定精确版本。
- 标准扫描只生成确定性基础知识；深度分析尚未实现，且只允许在用户明确要求后作为独立第二阶段启动。
- 不上传 `.codegraph`、原始源码、二进制、凭据、绝对路径或本地诊断；不读取 CodeGraph 内部 SQLite；不自动安装或升级 CodeGraph。
- 不保留 Codebase Memory 回退；无严格可验证 ownership marker 的历史页面不得猜测性自动删除。
- 未经单独授权不 commit、push、合并、发布 npm 或部署生产；本次 0.4.0 发布授权已执行完毕。

# 当前状态

- `codegraph-local-code-analysis` 第一阶段已完成：能力协商型 provider、中立快照、确定性基础分析、生成知识存储、Preview/确认同步、三客户端 onboarding 与 Codebase Memory 完整移除均已落地。
- 标准路径有两次独立确认：本地扫描计划哈希确认，以及最终 Preview 同步确认。
- 同一 source 的锁覆盖扫描、快照、分析、生成知识批量发布和 artifact 适配；公开 DTO、私有存储与 package exports 均已加固。
- 最终全分支审查经过五轮，结论为 0 Critical / 0 Important / 0 Minor。历史页面没有严格 marker 时一律保留，仅产生稳定不透明 warning。
- 功能分支冻结验证为 1,504 pass / 40 skip / 0 fail；合并到最新 `master` 后重新验证为 1,598 pass / 40 个缺少 `DATABASE_URL` 的显式 skip / 0 fail，其中 server 583、client 203、sync-protocol 22、local-sync 718，4 组 HTTP integration suites 已实际通过。
- Node 24 完整矩阵通过；官方 SHA-256 校验的临时 Node 26.7.0 通过 runtime contract 21/21 与 local-sync 718/718，随后已删除。
- 真实 CodeGraph 1.5.0 标准扫描 E2E 1/1、Codex/Claude Code/OpenCode onboarding harness 8/8、lint、typecheck、build、npm pack 边界与 diff check 均通过。
- 已生成实现提交 `6fffe08`、本地合并提交 `9852d96`、合并验证提交 `d9047a2`、0.4.0 发布准备提交 `11adb59` 和发布证据提交 `647c7f8`；GitHub `origin/master` 与 `v0.4.0` 标签均指向最终发布证据基线。
- npm `@neomei/agentwiki-local-sync@0.4.0` 已公开发布并成为 `latest`；公开 registry 全新安装、CLI 版本与私有 CodeGraph 子路径封闭均验证通过。
- 2026-08-20 已再次部署到 `root@113.249.120.24:/root/agentwiki`：生产 package/env 均为 0.4.0，远端四个关键源码 SHA-256 与本地一致，34 个 Prisma 迁移全部应用且无 pending，API/Worker/Frontend active、running、`NRestarts=0`。
- 公网 `https://agentwiki.quukk.com/api/health` 为 200，database/Redis/audit persistence 全部 `ok`；API 业务 smoke 18/18、UI 公开 5 路由/认证 16 路由/移动 6 路由通过，临时 user/Space/Agent 活跃残留均为 0。
- 0.4.0 部署前 PostgreSQL 和应用双备份位于 `/root/backups/agentwiki/pre-local-sync-0.4.0-20260820-110807.*`；正确的 AgentWiki custom dump 与应用 tar 均验证通过，SHA-256 分别为 `799170cd…d98ee`、`be220480…70b23`，权限均为 `0600`。此前 CodeGraph 切换备份继续保留。
- 同机 LLMRouter、new-api、PostgreSQL、Redis 等容器未被操作，部署后均为 running 且重启次数 0。本机临时 SSH 控制连接和包装器已删除，访问密码未保存。
- npm、GitHub 源码与生产 onboarding 公告均已对齐为 0.4.0。

# 稳定约束

- Agent 权限为 Credential Scope、Space Grant、Agent 状态与 Space Policy 的交集。
- 本地 Agent 只配置一个名为 `agentwiki` 的 stdio MCP gateway；远程 `/api/mcp` 只由 gateway 内部桥接。
- 本地知识按 Space 隔离；所有采集、整理、合并和敏感检查在本地完成。
- 服务端 Revision 是权威版本；Push 前 Pull，冲突必须用户确认。
- 自动图谱每层只管理自己的 origin；LLM 不自动发布；手动关系优先。
- 标准 CodeGraph 扫描不得隐式执行深度分析，也不得把未执行的深度层当作缺席删除。

# 关键索引

- 产品代码：`agentwiki/`
- 已归档任务：`.codex-memory/tasks/archive/codegraph-local-code-analysis/brief.md`
- CodeGraph 替换设计：`agentwiki/docs/superpowers/specs/2026-08-18-codegraph-local-code-analysis-design.md`
- CodeGraph 标准扫描计划：`agentwiki/docs/superpowers/plans/2026-08-18-codegraph-standard-scan-cutover.md`
- CodeGraph 最终加固设计：`agentwiki/docs/superpowers/specs/2026-08-19-codegraph-final-hardening-design.md`
- CodeGraph 最终验证：`agentwiki/docs/verification/codegraph-standard-scan-cutover.md`
- Local Sync 0.4.0 发布验证：`agentwiki/docs/verification/local-sync-0.4.0-release.md`
- CodeGraph 可选深度分析计划：`agentwiki/docs/superpowers/plans/2026-08-18-codegraph-optional-deep-analysis.md`
- GitHub：https://github.com/NeoMei/AgentWiki
- npm：https://www.npmjs.com/package/@neomei/agentwiki-local-sync

# 风险 / 下一步

- npm 0.4.0、GitHub 与生产部署均已完成并验证；生产关键源码指纹一致。
- 40 个数据库集成用例因当前环境没有 `DATABASE_URL` 而显式跳过；若发布流程要求数据库实跑，应在具备测试数据库的 CI/runner 补充证据。
- 第二阶段深度分析保持休眠；当前实现、发布物和默认路径都不会触发它。
- 外部 Agent 可通过 npm `latest` 获取 0.4.0 CodeGraph 标准扫描实现；后续发布继续遵循 tarball 审计、公开 registry 反向安装、双备份部署与公网 smoke 门禁。
