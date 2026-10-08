# Task 7 集成测试收尾报告

## 候选与范围
- worktree: `/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `（尾空格）。
- branch: `codex/test-fixes-20261008`。
- base: `869647d44570a690b73018aff45630dfc0fee4b2`。
- 提交: `b5446f7d` — `test: align integration navigation with source runs`。
- 只改 `App.spec.tsx` 与 `CollaborationWorkspace.test.tsx`，无 production code 修改；本报告按现有规则留在忽略的 `.superpowers/` 中。
- 保留进入任务时已有的未跟踪目录 `agentwiki/docs/verification/test-fixes-20261008/`，未添加到本提交。

## 原因与修正
- Task5 已将来源运行合并到 Sources 的 Runs tab，移除空间顶部 Runs，旧链接 replace 跳转到 Sources；两份集成测试仍要求旧入口。
- App 测试的 SourcesPage 全量 mock 还遗漏了新增 `LegacyRunsRoute` export，原失败日志存在相应未捕获错误。改为 partial mock，执行真实 LegacyRunsRoute，只隔离来源正文。
- App 路由矩阵保留全部原有空间身份与唯一导航断言，将旧 `/runs` 选中项改为 Sources，并增加查询式与路径式旧详情链接；验证目标路径、`view=runs`、run ID、其他 query、REPLACE 行为及来源正文。
- 导航断言限定在 Space navigation 内，要求没有顶部 Runs；保留 template/run ID 不得误用为空间 ID、无 sidebar 与无 folders/content-tree 请求断言，新增 ingest run ID 隔离校验。
- Collaboration 测试验证 Sources → Collaboration → Members 相对顺序，Sources 与 Collaboration 的独立 href、Collaboration 当前选中态及无顶部 Runs。Task3 能力测试未改动。

## 验证
工作目录：上述 worktree 下的 `agentwiki`。

- RED：`pnpm --filter @agentwiki/client exec vitest run src/App.spec.tsx src/features/collaboration/CollaborationWorkspace.test.tsx`，2 failed / 48 passed；`/tmp/agentwiki-task7-red.log`。
- GREEN：`pnpm --filter @agentwiki/client exec vitest run src/App.spec.tsx src/features/collaboration/CollaborationWorkspace.test.tsx src/components/SpaceNav.spec.tsx src/features/source/SourcesPage.spec.tsx src/features/source/RunsPage.spec.tsx src/features/space-workspace/workspaceNavigation.spec.ts`，6 files / **118 passed**；`/tmp/agentwiki-task7-unit-final.log`。
- 实际 Chrome：`AGENTWIKI_WEB_URL=http://127.0.0.1:5197 pnpm --filter @agentwiki/client exec playwright test e2e/source-runs-navigation.spec.ts --workers=1 --output=/tmp/agentwiki-task7-route-results`，**2 passed**；`/tmp/agentwiki-task7-route.log`。覆盖两种旧详情链接、Sources 内 Runs 选中、详情产物、retry/cancel 原 API、来源切换、foreign-run 不读取与 390px 宽度。
- `pnpm --filter @agentwiki/client exec tsc --noEmit`，exit 0；`/tmp/agentwiki-task7-typecheck-final.log`。首轮发现测试新增 `exact` 选项不被 Testing Library ByRoleOptions 支持，已移除并保留原失败日志 `/tmp/agentwiki-task7-typecheck.log`。
- `pnpm --filter @agentwiki/client exec eslint src/App.spec.tsx src/features/collaboration/CollaborationWorkspace.test.tsx`，exit 0；`/tmp/agentwiki-task7-lint-final.log`。
- `git diff --check`，exit 0。

## 环境与边界
- 自建 Vite 仅监听 `127.0.0.1:5197`；Playwright API 全部使用 Task5 的浏览器 fixture，无生产连接或数据库资源。
- 已终止自建 Vite 会话，`lsof -nP -iTCP:5197 -sTCP:LISTEN` 无输出，端口释放。
- 本轮定向检查不等同全 client 重跑、完整分支审查或生产验收；完整 branch review 由主代理统一覆盖该提交。
- 未发现需 production 修复的问题；未 push、merge、release 或 deploy。提交与本报告完成后停止工作树写入。

## 追加：全量门禁发现的旧应用版本契约
- 主代理全量 `pnpm test` 在 runtime 阶段发现 `application release versions and independent sync versions stay aligned` 仍把三个应用包固定为 `0.12.12`；当前根包、server、client 实际均为 `0.12.16`。主代理明确授权测试修正。
- 追加基线：`b5446f7d7cd7038ffaa2db3c61f3893d96aaf53e`。
- 单独提交：`167237a1` — `test: derive application release alignment from root version`。
- 只修改 `agentwiki/scripts/node-runtime-contract.test.mjs`：使用根包已有直接开发依赖 `semver` 检验根版本有效性，再要求根包、server、client 均等于该规范语义版本。这样契约验证应用包统一发布，不随每次补丁发布积累旧版本常量。
- Local Sync `0.11.0`、sync protocol `0.6.1` 仍独立锁定；环境示例、compose 中 Local Sync 版本及协作测试脚本断言原样保留。没有更改任何 package 版本、依赖清单、lockfile 或 production code。
- RED：`node --test scripts/node-runtime-contract.test.mjs`，32 pass / 1 fail / 0 skipped；`/tmp/agentwiki-task7-version-red.log`。
- GREEN：相同命令，**33 pass / 0 fail / 0 skipped**；`/tmp/agentwiki-task7-version-green.log`。没有连接数据库。
- `git diff --check` exit 0；差异仅一份测试文件，7 insertions / 2 deletions。
- 主代理的原最终 review 冻结于 `b5446f7d`，该小差异等待追加 review；不将本次单文件通过当作完整门禁通过。提交与报告追加后再次停止工作树写入。
