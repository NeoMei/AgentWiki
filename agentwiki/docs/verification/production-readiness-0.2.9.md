# AgentWiki 0.2.9 上线验收报告

> 验收日期：2026-08-10  
> 范围：任务完成度、代码审查、前后端/本地同步/UI 功能、发布门禁

## 结论

0.2.9 的本地实现、npm 发布、生产部署和验证门禁均已通过，本轮修复了以下会阻断使用或影响上线安全的问题：

1. codebase-memory 本机原生可执行文件被 Node 当作 JavaScript 加载，导致扫描失败。
2. 文档适配器误用了同名 npm 包，而非 Microsoft MarkItDown；现改为私有 Python 3.10+ venv 和精确版本 0.1.6。
3. 使用指南、界面和 `/api/onboard` 仍有旧 npm scope；已统一为 `@neomei/agentwiki-local-sync`。
4. 文档多层目录达到 `maxFiles` 后父目录仍可继续扫描；现已确保全局不超过用户限额。
5. 运行时 checksum 跳过点目录，未覆盖 Python `.venv` 和 Node `.bin`；现已将实际执行入口纳入校验。
6. 生产依赖含 Hono、Node Server、`qs`、`body-parser` 和 React Router 已修复漏洞版本；已升级 MCP SDK 和 React Router 7，并完成真实浏览器回归。
7. 生产 Nginx 将 `/socket.io/` 错送到 Vite，WebSocket 握手返回 400；现增加直连 NestJS 的专用 Upgrade 路由，并加入配置契约测试。

发布前已创建生产代码、环境和 PostgreSQL 备份。npm 0.2.9 已经 WebAuthn 批准，生产 API、Worker、Frontend 均已部署并通过受控写入验证。

## 自动化门禁

| 范围 | 结果 |
| --- | --- |
| Runtime / 数据库契约 | 65 / 65，真实 PostgreSQL，0 跳过 |
| Server | 45 suites / 369 tests |
| Client | 30 files / 124 tests |
| local-sync | 23 files / 181 tests |
| 合计 | 739 tests |
| TypeScript | `pnpm typecheck` 通过 |
| Lint | `pnpm lint` 通过，0 errors |
| Build | `pnpm build` 通过 |
| 依赖审计 | 0 high / 0 critical / 0 low；3 moderate，均不可达 |
| 发布包 | 78 files，63.1 kB packed，无测试、`.env`、key、token、tgz 或数据库 |

## 真实功能验证

- 完整本地栈：PostgreSQL 临时数据库 + Redis 独立 namespace + API + Worker + Vite。
- API smoke：18 项通过。
- codebase-memory：真实扫描成功，2689 节点 / 7368 边，产出非空架构知识和 provenance。
- MarkItDown：自动选择 Python 3.12，隔离安装 Microsoft MarkItDown 0.1.6，真实 PDF 转换、运行时复用和 checksum 校验通过。
- local-sync orchestrator：本地扫描、组织、预览、确认、推送、关系与证据通过。
- 双向同步：两工作区 Pull/Push、Snapshot/Delta、页面、记忆、关系、冲突阻断和审批删除通过。
- OpenCode 编辑辅助：免费模型完成真实任务，返回非空 changes。
- UI：3 个公开路由、16 个登录后路由、6 个移动端路由通过；Space Agent 成员桌面/移动端通过。
- 生产只读 UI：`/`、`/guide`、`/onboard` 桌面/移动端无空白、无横向溢出、无 console/page error、无 5xx。
- React Router 7 全栈 UI 回归：3 个公开、16 个登录后、6 个移动端路由以及 Space Agent 成员操作再次通过。
- 生产 API smoke：18 项通过，测试用户、Space 和 Agent 在 `finally` 中清理。
- 生产 UI：3 个公开路由、16 个登录后路由、6 个移动端路由通过；Space 添加 Agent 成员桌面/移动端通过。
- 生产 WebSocket：修复前稳定返回 400，修复后公网 `wss` 握手返回 101。

## 依赖风险处理

- 已升级/固定：MCP SDK 1.30.0、Hono 4.13.1、Hono Node Server 2.1.0、`qs` 6.15.3、`body-parser` 1.20.6、React Router 7.18.2。
- 剩余两条 `file-type` moderate 由 Nest 10 的内部依赖引入；项目未使用 `FileTypeValidator` 或该包解析上传文件。
- 剩余一条 Nest SSE moderate 只在将攻击者可控值映射到 `@Sse` 事件 `id/type` 时可达；项目无 `@Sse`、`SseStream` 或 `ServerSentEvent` 路由。
- 直接强制 `file-type` 21 或 Nest 11 是不必要的主版本替换，当前可达性证据不支持承担该回归风险。

## 代码图谱与审查

- codebase-memory 全量索引：3883 节点 / 10151 边，0 跳过文件。
- 架构、符号、源码和调用链查询均可用。
- 重复检查旧 npm scope、已退役外部编译器痕迹、TODO/FIXME、敏感信息、差异格式与活跃版本号。
- 本轮结束时未发现还有值得修复的本地代码缺陷。

## 发布结果

1. npm：`@neomei/agentwiki-local-sync` 的公网 `latest=0.2.9`；过期 0.2.6、0.2.7、0.2.8 暂存项均已拒绝。
2. 生产：备份位于 `/root/agentwiki-backups/20260810-114802`；源码与 `/api/onboard.json` 均为 0.2.9，安装命令包含 `--orchestrator`。
3. 运行状态：API、Worker、Frontend 三个 systemd 服务均为 active；健康检查的 database、redis、auditPersistence 均为 ok。
4. 生产变更：Nginx 配置先经 `nginx -t`，再 reload；WebSocket、API smoke、完整 UI 路由和 Space Agent 成员测试均通过。
