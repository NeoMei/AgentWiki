# Task 4：审核日期筛选（#19）

状态：本地修复及定向验证通过；主任务已串行提交 5 个代码/测试文件为 `1c61b3b3`，待独立审查、集成浏览器验收。报告随后补充；未发布、未改生产数据。

## 根因与修复

主任务已在生产浏览器（Asia/Shanghai）原生键盘复现：起止均选 `2026-10-14`，搜索结果含 `10/15 01:27、01:44、03:00`。

前端现有逻辑正确地将本地 `10/14 00:00` 转成 `2026-10-13T16:00:00.000Z`，将结束日期的次日本地零点转成 `2026-10-14T16:00:00.000Z`，发送半开区间。它使用 `setDate(+1)`，因而也能保留夏令时 23/25 小时日的边界。

根因在审核服务的 raw SQL：Prisma 将 JavaScript `Date` 参数绑定为 `timestamp with time zone`，但 `ChangeSet.createdAt` 是存放 UTC 数字的 `timestamp(3) without time zone`。PostgreSQL 比较这两种类型时使用数据库 session 时区解释列值，因此不是在同一时间基准上比较。在数据库 Asia/Shanghai 会话中，所选 UTC 边界等效于把筛选窗口整体向后移动 8 小时：当天前 8 小时会漏掉，次日凌晨会被包含。

在本机独立数据库 `agentwiki_review_date_test_20261016`（仅 `127.0.0.1`）运行真实 Prisma raw query 得到：

| 数据库 session 时区 | Prisma Date 参数类型 | to 参数转换成 timestamp 的值 | 存储为 `2026-10-14 19:00:00`（上海次日 03:00）是否被旧条件包含 |
| --- | --- | --- | --- |
| UTC | timestamp with time zone | 2026-10-14 16:00:00 | 否 |
| Asia/Shanghai | timestamp with time zone | 2026-10-15 00:00:00 | 是 |
| America/New_York | timestamp with time zone | 2026-10-14 12:00:00 | 否（窗口向另一方向偏移） |

修复在参数端显式 `::timestamptz AT TIME ZONE 'UTC'`，使其与 UTC timestamp 列在同一基准比较；保持 `>= from`、`< to`，未对列套函数、未硬编码用户时区、未改权限和分页规则。

同时收紧 API 输入：日期必须是带明确 `Z` 或 `±HH:mm` 时区的有效 ISO 日期时间。无时区日期、不存在的 `2026-02-30`、非闰年 `02-29` 被拒绝；显式 offset、合法闰日、只填开始或结束保持可用。接口注释明确开始包含、结束不包含。

## 失败到通过

在改动生产代码之前，先加入数据库矩阵与输入校验回归并执行：**12 failed / 26 passed / 0 skipped**。失败由 8 项非 UTC 数据库会话偏移和 4 项无时区/不存在日期漏检组成；不是测试启动或环境故障。日志：[red.log](task-4-evidence/red.log)。

相同测试在修复后：**38 passed / 0 failed / 0 skipped**，其中真实数据库 15 项（既有 3 + 新增矩阵 12）、查询校验 23 项。日志：[green-db.log](task-4-evidence/green-db.log)。

| 浏览器日历场景 | 发送的 UTC 半开边界 | DB UTC | DB Asia/Shanghai | DB America/New_York |
| --- | --- | --- | --- | --- |
| 上海 2026-10-14 | 10/13 16:00 → 10/14 16:00 | 修复前后通过 | 失败→通过 | 失败→通过 |
| UTC 2026-10-14 | 10/14 00:00 → 10/15 00:00 | 修复前后通过 | 失败→通过 | 失败→通过 |
| 纽约 2026-03-08（23 小时） | 03/08 05:00 → 03/09 04:00 | 修复前后通过 | 失败→通过 | 失败→通过 |
| 纽约 2026-11-01（25 小时） | 11/01 04:00 → 11/02 05:00 | 修复前后通过 | 失败→通过 | 失败→通过 |

每个矩阵案例都通过真实 `ReviewService.listPage` 和 PostgreSQL 验证：开始前 1ms 排除、开始零点包含、当天中午和 23:59:59.999 包含、次日零点及 03:00 排除；只填 from/to；搜索 + 状态 + 空间过滤；两页稳定结果、越界页保留正确总数；不可访问空间不出现。事务内设置 session 时区，保证所有相关 SQL 使用同一连接。

前端真实 `ReviewPage` 组件新增 12 个请求契约回归（4 个日历场景 × 双边界/from-only/to-only），断言送出上表字面量 UTC 时间，防止将来改成 date-only UTC 解析或固定 24 小时。前端生产代码未改变。

## 命令及结果

命令工作目录：`/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki /agentwiki`。

| 命令 | 结果 |
| --- | --- |
| `AGENTWIKI_PSQL_BIN=/opt/homebrew/bin/psql PG_DUMP_BIN=/opt/homebrew/bin/pg_dump node /tmp/agentwiki-review-date-db-run.mjs`（修复前） | exit 1；12 failed / 26 passed |
| 同一 DB 命令（修复后） | exit 0；38 passed |
| `pnpm --filter @agentwiki/client exec vitest run src/features/review/ReviewPage.spec.tsx` | exit 0；91 passed，含新增 12 项；[日志](task-4-evidence/client.log) |
| `pnpm --filter @agentwiki/server test review` | exit 0；213 passed / 27 skipped（未设置 DB 环境时的 2 个 DB suite；审核日期 DB suite 已上文单独实跑） |
| `pnpm --filter @agentwiki/server exec tsc --noEmit --incremental false` | exit 0 |
| `pnpm --filter @agentwiki/client exec tsc --noEmit` | exit 0 |
| `pnpm --filter @agentwiki/server exec eslint src/review/review.service.ts src/review/review-list.query.ts src/review/review-list.query.spec.ts src/review/review-list.db.spec.ts` | exit 0 |
| `pnpm --filter @agentwiki/client exec eslint src/features/review/ReviewPage.spec.tsx` | exit 0 |
| `git --work-tree='/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki ' diff --check -- agentwiki/apps/server/src/review agentwiki/apps/client/src/features/review` | exit 0 |

DB runner 调用已有 `withCollaborationTestDatabase`：随机 `collaboration_test_*` schema、完整迁移、保护结构前后摘要核对、finally 清理。回调通过 `DATABASE_URL=COLLABORATION_TEST_DATABASE_URL=databaseUrl` 执行 `pnpm --filter @agentwiki/server test --runTestsByPath src/review/review-list.db.spec.ts src/review/review-list.query.spec.ts`。新增测试放进现有 DB 文件，因此正式 `scripts/server-test-harness.mjs run` / 全量测试也会执行。

复现最小 runner（先准备带 `test` 名称、public vector 扩展的独立本机测试数据库；环境变量必须显式指向该 loopback 数据库）：

```js
import { spawnSync } from 'node:child_process';
import { withCollaborationTestDatabase } from './scripts/collaboration-test-database.mjs';
await withCollaborationTestDatabase(process.env.COLLABORATION_TEST_DATABASE_URL, async ({ databaseUrl }) => {
  const result = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'test', '--runTestsByPath',
    'src/review/review-list.db.spec.ts', 'src/review/review-list.query.spec.ts'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, COLLABORATION_TEST_DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
});
```

清理回读：`collaboration_test_*` schema 数量为 `0`；`DROP DATABASE agentwiki_review_date_test_20261016` 成功，`pg_database` 同名数量为 `0`。未读取生产凭据或生产数据库。

## 改动文件

- `apps/server/src/review/review.service.ts`：SQL 参数显式转换为 UTC timestamp。
- `apps/server/src/review/review-list.query.ts`：带时区的严格 ISO 校验与范围契约说明。
- `apps/server/src/review/review-list.query.spec.ts`：无时区、不存在日期、合法 offset/单边界/闰日校验。
- `apps/server/src/review/review-list.db.spec.ts`：真实 PostgreSQL 时区矩阵、日期边界及权限/组合筛选/分页回归。
- `apps/client/src/features/review/ReviewPage.spec.tsx`：本地日历日、DST 和单边界 API 请求回归。
- 本报告及 `task-4-evidence/{red.log,green-db.log,client.log}`。

## 验收边界

生产浏览器只提供原缺陷的复现证据；本修复尚未部署。独立任务审查、整分支审查和真实浏览器候选/生产回验由主任务继续完成，不能将本地 DB/组件通过记为原生产反馈已经关闭。
