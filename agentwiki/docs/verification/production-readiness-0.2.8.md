# AgentWiki 0.2.8 上线验收报告

> 验收日期：2026-08-10  
> 范围：任务完成度、代码审查、前后端/本地同步/UI 功能、发布门禁

## 结论

0.2.8 的本地实现和验证门禁已通过，本轮修复了三类会直接阻断用户的问题：

1. codebase-memory 本机原生可执行文件被 Node 当作 JavaScript 加载，导致扫描失败。
2. 文档适配器误用了同名 npm 包，而非 Microsoft MarkItDown；现改为私有 Python 3.10+ venv 和精确版本 0.1.6。
3. 使用指南、界面和 `/api/onboard` 仍有旧 npm scope；已统一为 `@neomei/agentwiki-local-sync`。
4. 文档多层目录达到 `maxFiles` 后父目录仍可继续扫描；现已确保全局不超过用户限额。
5. 运行时 checksum 跳过点目录，未覆盖 Python `.venv` 和 Node `.bin`；现已将实际执行入口纳入校验。

本地可完成的任务已完成。npm 批准与生产部署仍是外部权限门禁，本报告不将其冒充为已完成。

## 自动化门禁

| 范围 | 结果 |
| --- | --- |
| Runtime / 数据库契约 | 63 / 63，真实 PostgreSQL，0 跳过 |
| Server | 45 suites / 369 tests |
| Client | 30 files / 124 tests |
| local-sync | 23 files / 181 tests |
| 合计 | 737 tests |
| TypeScript | `pnpm typecheck` 通过 |
| Lint | `pnpm lint` 通过，0 errors |
| Build | `pnpm build` 通过 |
| 依赖审计 | 0 high / 0 critical；11 moderate / 2 low |
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
- 生产只读 UI：`/`、`/guide`、`/onboard` 桌面/移动端无穽白、无横向溢出、无 console/page error、无 5xx。

## 代码图谱与审查

- codebase-memory 全量索引：3882 节点 / 10152 边，0 跳过文件。
- 架构、符号、源码和调用链查询均可用。
- 重复检查旧 npm scope、已退役外部编译器痕迹、TODO/FIXME、敏感信息、差异格式与活跃版本号。
- 本轮结束时未发现还有值得修复的本地代码缺陷。

## 外部发布门禁

1. npm：0.2.8 已暂存为 public/latest，ID `5eb4e3c5-657b-4dfb-b416-602226d064e4`，tarball shasum `1100c50ad0634d27b2b56912057f7433298ba6a8`；公网仍是 0.2.5，需在 npm Staged Packages 完成 WebAuthn 批准。过期 0.2.6/0.2.7 暂存项应拒绝。
2. 生产：`/api/health` 正常，但 `/api/onboard.json` 仍为 0.2.3。`root@113.249.120.24` 的 SSH 认证被拒绝，因此无法执行备份、迁移、部署和生产受控写入 E2E。

两项完成后，应重新核对 npm `latest=0.2.8`、生产 onboarding `version=0.2.8`、健康检查与受控写入 UI E2E。
