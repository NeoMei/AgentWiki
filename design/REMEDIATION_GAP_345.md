# 第 3/4/5 条需求差异复核

本文件记录 2026-07-15 二次代码审计发现的差异。只有实现、测试、构建和界面验证全部通过后才能勾选。

## 3. 界面入口

- [x] 全局主导航只保留 Spaces、Agents、Review、Search、个人菜单；About/Guide/Integrations 收入个人菜单。
- [x] 空间主入口统一为 Pages、Graph、Sources、Runs、Members、Settings，不保留重叠 Tree/Docs/空间 Review。
- [x] Profile 全部使用“个人访问令牌”措辞，不再显示 Agent 账号/API Key 旧概念。
- [x] 页面“来源与变更”侧栏展示生成方式、来源 URI/文件、Git commit、Run、Evidence 定位/置信度、审批人和发布时间。
- [x] 图谱边展示来源、生成者、Evidence、置信度和审批状态。
- [x] Integrations/MCP 展示实际 Credential Scope、Space Grant、工具映射和最近调用。

## 4. 关键设计与领域闭环

- [x] 修复部分审批：只有 accepted 项可发布，存在 pending 项时不得整体批准。
- [x] Review 提供结构化候选差异，并覆盖并发、绕过、部分批准、发布、回滚测试。
- [x] 摄取真实经过 indexing，支持 partial；取消在各阶段生效。
- [x] Git 增量保留逐文件路径/哈希/commit 快照，而不只是计数。
- [x] 记忆用例、质量指标和启用门槛形成正式规格。
- [x] MCP、REST 和 Worker 共用领域授权及审计边界。

## 5. 首个整改包遗留

- [x] 提供可独立运行的摄取 Worker，生产 API 进程不执行耗时任务。
- [x] 增加经过 HTTP、认证 Guard、Controller 和授权服务的权限集成测试。
- [x] 删除失活的 DocumentGeneration 代码、数据模型和前端死代码，保留历史迁移。
- [x] 清理 `src` 下编译生成的 JavaScript 污染，并确保不会由标准脚本再次产生。
- [x] 完成 lint、类型、测试、构建、空库迁移、运行时、桌面和移动端验收。

## 最终证据（2026-07-15）

- `pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过。
- Jest：12 个测试套件、46 项测试通过，含真实 HTTP → Guard → Controller → Authorization 链路。
- Prisma：12 个迁移从隔离空 schema 全量执行，PageVersion 两个历史外键复核成功；临时 schema 已清理。
- 运行时：生产构建的 API 与独立 Worker 在隔离 schema 同时启动成功。
- UI：Chrome/Playwright 覆盖空间导航、Sources、页面来源侧栏、图谱、Review、Integrations/MCP 和 390×844 移动端；浏览器控制台零错误。
- 清理：`apps/server/src` 下编译生成 JavaScript 数量为 0；旧 DocumentGeneration TypeScript、前端组件与 Prisma 模型已删除。
