# CodeGraph 本地代码分析替换

## 目标

将 AgentWiki 的本地代码扫描从 `codebase-memory-mcp` 调整为 CodeGraph 扫描、AgentWiki 分析和派生知识同步，同时保持双方版本生命周期解耦。

## 完成状态

- 2026-08-18：设计与标准/深度双模式获用户确认。
- 2026-08-20：第一阶段产品代码、迁移安全边界、三客户端 onboarding、真实 CodeGraph E2E、旧模块移除和文档全部完成。
- 最终全分支审查经过五轮，以 0 Critical / 0 Important / 0 Minor 批准。
- 功能分支冻结验证为 1,504 pass / 40 skip / 0 fail；合并到最新 `master` 后重新验证为 1,598 pass / 40 skip / 0 fail。
- Node 24、官方 SHA-256 校验的 Node 26.7.0、真实 CodeGraph 1.5.0 与三客户端 onboarding 均通过规定矩阵。
- 实现提交 `6fffe08`，本地合并提交 `9852d96`，合并验证文档提交 `d9047a2`；功能 worktree 与分支已清理。
- GitHub `master` 已包含 0.4.0 发布提交，npm `@neomei/agentwiki-local-sync@0.4.0` 已公开发布并成为 `latest`，生产已再次部署并通过健康、业务和 UI smoke。深度分析仍是用户以后主动要求时才执行的独立第二阶段。

## 发布证据

- 生产主机：`root@113.249.120.24:/root/agentwiki`；公网入口：`https://agentwiki.quukk.com`。
- 部署前 PostgreSQL custom dump 与应用回滚包：`/root/backups/agentwiki/pre-codegraph-20260820-025137.*`，完整性、SHA-256 和 `0600` 权限均验证通过。
- 远端关键源码聚合 SHA-256 与本地一致；34 个 Prisma 迁移全部应用，无 pending。
- API/Worker/Frontend active、running、`NRestarts=0`；公网 health 的 database、Redis、audit persistence 全部 `ok`。
- API smoke 18/18，UI smoke 为公开 5、认证 16、移动 6 路由；临时资源活跃残留为 0。
- 同机其他容器未被操作，部署后均保持 running 且重启次数 0；本机临时 SSH 材料已清理。
- 0.4.0 发布 tarball SHA-1 为 `ec07b5800280daf3c41de5b415fb6ee5110458f2`，SHA-256 为 `16ac71d2f5d363db15a45166eb6a7ac87c9b30c91f83aff0f8a4215e76e97700`；公开 registry 全新安装与私有子路径封闭验证通过。
- 0.4.0 部署前备份为 `/root/backups/agentwiki/pre-local-sync-0.4.0-20260820-110807.*`，正确的 AgentWiki PostgreSQL dump 与应用包 SHA-256 分别为 `799170cd…d98ee`、`be220480…70b23`，权限均为 `0600`。

## 已完成范围

- AgentWiki 内置能力协商型 `CodeGraphProvider`。
- CodeGraph 独立安装、升级和维护 `.codegraph/`。
- `agentwiki-code-snapshot@1` 中立快照与确定性基础分析。
- 生成本地 Markdown/SourceArtifact，经两次独立确认后同步。
- 完整移除 Codebase Memory 生产路径、包导出和构建残留。
- 无严格 ownership marker 的历史页面保留并告警，不做猜测性自动删除。

## 保持不做

- 不上传 `.codegraph`、原始代码、凭据、绝对路径或诊断。
- 不自动安装或升级 CodeGraph，不绑定精确版本，不读取内部 SQLite。
- 不自动执行深度分析，不保留 Codebase Memory 回退。

## 计划

- 已完成第一阶段：`agentwiki/docs/superpowers/plans/2026-08-18-codegraph-standard-scan-cutover.md`
- 可选第二阶段：`agentwiki/docs/superpowers/plans/2026-08-18-codegraph-optional-deep-analysis.md`
