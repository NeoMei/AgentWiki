# AgentWiki macOS final fix report

日期：2026-09-04（Asia/Shanghai）

## Status

- 结论：**PASS**。
- 审查基线：`efb316ff0447b82d0875f2311678fd397bb34ab2`。
- 已测试代码：`23a25f888b76b9ce4b8a8cc76dd5164e1c80034b`。
- 代码提交：`23a25f888b76b9ce4b8a8cc76dd5164e1c80034b fix(test): close macOS release verification gaps`。
- 证据提交：本报告、正式验证记录和项目记忆所在的独立 `test(release): record final macOS verification` 提交；Git commit 无法在不改变自身 SHA 的前提下自嵌最终 SHA，精确 SHA 在提交后写入最终回报。
- 没有 push、npm publish 或生产部署；没有使用生产 key、外部业务 secret 或 paid fallback。

## Findings：逐项 RED / GREEN

### Important 1：Markdown 同目录目标

- RED：unit 中 source-relative exact target 失败 1 项；真实 PostgreSQL 回归失败 1/1，`pages/Project/Source.md` 的 `[[Target.md]]` 错误命中 `pages/Target.md`，而非同目录 `pages/Project/Target.md`。
- 修复：先加载 source page，再把 source-relative canonical path 纳入 exact query；alias query 与 exact query 使用同一组 resolved targets。
- GREEN：unit 覆盖同目录 canonical、根 canonical 和 duplicate title；server focused 总门 135/135，真实 Markdown DB 1/1。

### Important 2：跨平台 launcher 与 migration timeout

- RED：`package-manager-process.test.mjs` 为 2 fail / 3 pass，证明 Windows `.cmd` 配置 shim 被错误交给 Node，且 migration 没有统一上界。
- 修复：只接受 JS package-manager entrypoint，Windows 由 `process.execPath` 启动；新增 `boundedMigrationOptions`，默认/最大 90,000 ms，非正整数或非 safe integer fail closed。
- 修复范围：server test harness、instance rotate CLI test、pgvector DB，以及相关 Markdown/page-template/collaboration DB harness；目标文件直 spawn `pnpm` / `npx` 扫描为 0。
- GREEN：launcher + server harness + instance 8/8；page-template DB 2/2；pgvector DB 4/4。

### Important 3：附件 E2E gate 与限流隔离事实一致

- RED：9 个无效隔离组合在旧逻辑下仍放宽 `/tmp/agentwiki-mac-attachments.*`。
- 修复：抽出共享 `isIsolatedE2EEnvironment`。只有 `NODE_ENV=test`、API loopback、PostgreSQL loopback、database name 含 `test`、且 query 恰好一个合法 `mac_e2e_*` schema 时，附件例外和 E2E 限流 override 才生效。
- GREEN：四个 server focused suites 总计 135/135；实际 E2E 用同一组事实启动且 attachment health 为 `ok`。

### Important 4：显式、credential-safe pg_dump

- RED：protected-inventory unit 1/1 失败，因为缺少显式 preflight/helper。
- 修复：要求绝对 `PG_DUMP_BIN`；先执行 `--version`，并与 server `server_version_num` 检查同 major；数据库 URI argv 删除 password，只通过 `PGPASSWORD` 环境传递；version/dump 子进程分别有 10/30 秒 timeout。
- GREEN：unit 1/1、真实 protected inventory 2/2。实际为 `/opt/homebrew/bin/pg_dump`，client 16.14、server 16.15，major 均为 16。

### Minor 1–3

- 正式验证记录已改为直接陈述最终代码 SHA 的真实 clean-clone 完整证据。
- archive decisions 已区分“历史发布授权范围”与“本 final-fix wave 明确不 push 的执行状态”，不再互相矛盾。
- periodic sweep 与 queued refresh 使用同一个精确 deleted-Space predicate，仅忽略 `ForbiddenException('Space not found')`；其他错误仍写日志。periodic RED 1/1，GREEN 纳入 135/135。

### RED / GREEN 总计

- RED：15 个失败 case = launcher 2 + server 11 + pg_dump 1 + 真实 Markdown DB 1。
- GREEN：launcher/server/instance 8/8；server 135/135；pg_dump 1/1；Markdown DB 1/1；page-template DB 2/2；pgvector DB 4/4；inventory 2/2。
- focused server typecheck、目标 lint 均 exit 0；focused schema residue 0；protected digest before/after 均为 `79642c9fc9d560bdbadd4828bcb75b6796a0a56ec1c45638d1e6d9ddd2b0e2e3`。

## Code commit 与文件清单

代码提交共 19 files、390 insertions、74 deletions：

1. `agentwiki/apps/server/src/attachments/attachment.config.ts`
2. `agentwiki/apps/server/src/attachments/local-attachment.storage.spec.ts`
3. `agentwiki/apps/server/src/core/security/e2e-isolation.ts`
4. `agentwiki/apps/server/src/core/security/rate-limit.guard.ts`
5. `agentwiki/apps/server/src/knowledge-graph/graph-maintenance.spec.ts`
6. `agentwiki/apps/server/src/knowledge-graph/graph-maintenance.ts`
7. `agentwiki/apps/server/src/markdown-resources/markdown-resource.service.spec.ts`
8. `agentwiki/apps/server/src/markdown-resources/markdown-resource.service.ts`
9. `agentwiki/scripts/collaboration-test-database.mjs`
10. `agentwiki/scripts/content-tree-core-db.test.mjs`
11. `agentwiki/scripts/folder-test-database.mjs`
12. `agentwiki/scripts/instance-rotate.cli.test.mjs`
13. `agentwiki/scripts/markdown-resource-resolution-db.test.mjs`
14. `agentwiki/scripts/markdown-test-database.mjs`
15. `agentwiki/scripts/package-manager-process.mjs`
16. `agentwiki/scripts/package-manager-process.test.mjs`
17. `agentwiki/scripts/page-template-test-database.mjs`
18. `agentwiki/scripts/pgvector-semantic-search-db.test.mjs`
19. `agentwiki/scripts/server-test-harness.mjs`

## Disposable services

- 启动前 55432/56379 均无 listener，容器名无冲突。
- 第一次 `--rm` PostgreSQL 容器 `c639038…` 在 readiness 期间自行消失；自动删除后没有日志可证明根因，未作为 PASS 证据。
- authoritative PostgreSQL：`871bccd0242434e4a1f2535f25a9013cedcdef836219db406eecc8fd3ff09f04`，`pgvector/pgvector:pg16`，`127.0.0.1:55432`，专用 `agentwiki_test_finalfix` 数据库。
- authoritative Redis：`be51bd3dbf2b7f99a672ce5c595a4211d8f6dbeb96c729b5b49b7e0f8c8bc17b`，`redis:7.4-alpine`，`127.0.0.1:56379`。
- 两者均 `auto_remove=true`；PG 16.15、vector 0.8.6、public 0 tables、`hnsw.ef_search=200`；Redis PONG、AOF yes/everysec，SET/GET/DEL 与两次 local WAITAOF 成功。

## Final code SHA clean clone

- `git clone --no-local`：`/private/tmp/agentwiki-mac-clean-clone-finalfix.DZor7f/repo`。
- 初始 HEAD 精确匹配代码 SHA，status clean，无 `node_modules`，五个目标 workspace 无预存 `dist`；fresh clone 的 `.codegraph` 只有 tracked `.gitignore`，未 init。
- `pnpm install --frozen-lockfile` exit 0：6 workspace projects、1115 packages、policy 1221 entries；标准 registry retries 最终恢复，没有绕过 lockfile/supply-chain policy。
- 根 `pnpm test` 明确配置 DATABASE/FOLDER/MARKDOWN/COLLABORATION/PAGE_TEMPLATE URLs、两个 Redis URLs 与 `PG_DUMP_BIN`，exit 0。

| Phase | Total | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| runtime parallel | 167 | 166 | 0 | 1 |
| runtime DB serial | 139 | 139 | 0 | 0 |
| server | 1850 | 1849 | 0 | 1 |
| client | 1120 | 1120 | 0 | 0 |
| sync-protocol | 57 | 57 | 0 | 0 |
| local-sync | 878 | 877 | 0 | 1 |
| **Total** | **4211** | **4208** | **0** | **3** |

- 3 skips 是 CodeGraph 显式 opt-in、Windows OpenCode executable、Windows ACL；不是缺少数据库、Redis、Playwright 或 CodeGraph。
- missing-prerequisite exact scan 0 matches；public inventory digest 多次 before==after；测试前缀 schema residue 0；public tables 0。
- `pnpm typecheck` exit 0；`pnpm lint` exit 0；`pnpm build` exit 0；`git diff --check` exit 0。唯一 build notice 是 Vite 大 chunk warning。
- 裸 `pnpm audit` 第 1–5 次均在官方 bulk POST 的标准三次请求重试后 timeout / exit 1；空 POST、IPv4、IPv6、HTTP/1.1 探针均 0 bytes timeout。第 6 次不改命令、registry、lockfile 或参数，exit 0：`No known vulnerabilities found`。失败与最终成功都保留，没有绕过。

## CodeGraph

- CLI path `/Users/neomei/.npm-global/bin/codegraph`，version 1.6.0。
- `AGENTWIKI_CODEGRAPH_E2E=1 AGENTWIKI_CODEGRAPH_BIN=… pnpm test:e2e:codegraph-standard-scan` exit 0：1 pass / 0 fail / 0 skip / 0 cancelled / 0 todo。
- 真实 scanner 在测试临时 fixture 内运行；未 init clean clone，也未向服务端发送 private source/scanner payload。

## Playwright full stack

- E2E schema：`mac_e2e_20260904060632_46490`，运行时恰好一个匹配 schema；附件根：`/tmp/agentwiki-mac-attachments.F8pAW8`。
- 所有 secrets 为本轮随机或显式 test-only；paid fallback=false。
- migrate deploy 49/49；schema 64 tables，public 0；API/worker/client 在独立 PGID 49952 下启动；health 五项均 `ok`。
- list exit 0：7 files / 25 tests。
- run exit 0：`--workers=1 --retries=0`，25 pass / 0 fail / 0 skip，47.2 秒。
- `.last-run.json` 为 passed、failedTests 空；没有 failure trace。
- `GRAPH_SWEEP_MS=2000`，suite 后额外等待 5 秒；graph race/sweep failure、Unhandled、FATAL、ECONN、Prisma error 均 0。API 仅有预期负路径 4×403、1×404、1×409，最终 health 仍全 ok。

## Cleanup

- PGID 49952 的 8 个成员、UID、完整 command、CWD 和 listener 归属均先快照。第一版信号 guard 因 zsh 字符串未拆分而 exit 53，fail closed 于 TERM 前；第二版显式数组验证全部通过后，组级 TERM exit 0，成员 8→0，3000/5173 clear。
- schema guard 通过；精确 schema count 1→0。附件是非 symlink、0700、UID 501，含 2 文件；移动至 `/Users/neomei/.Trash/agentwiki-macos-finalfix.pG4uH2/agentwiki-mac-attachments.F8pAW8`，原路径 absent，副本 2 文件可恢复。
- 所有可连接 DB（`agentwiki_test_finalfix`、`postgres`）的目标前缀 schema 总数 0，public 0。
- 两容器在 stop 前以 full ID 验证 running/auto-remove/name/loopback ports；full-ID stop 后 inspect 均 exit 1，名称匹配 0。
- 最终 PGID 0 members、原附件路径 absent、3000/5173/55432/56379 clear。clean-clone 清理第一版因 zsh 只读变量 `status` 在移动前 exit 1；第二版确认精确路径、目录、非 symlink、HEAD、clean status 与 CWD process 0 后，可恢复地移入 `/Users/neomei/.Trash/agentwiki-macos-clean-clone.JcE6tM/agentwiki-mac-clean-clone-finalfix.DZor7f`，原路径 absent。

## Evidence files

1. `agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
2. `.codex-memory/current.md`
3. `.codex-memory/tasks/index.md`
4. `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/brief.md`
5. `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/decisions.md`
6. `.codex-memory/tasks/archive/macos-release-verification-2026-09-04/refs.md`
7. `.superpowers/sdd/2026-09-04-macos-release-verification/final-fix-report.md`

## 自审与 concerns

- 已逐条对照 4 个 Important、3 个 Minor 和 required re-verification；未发现遗漏门禁或未清资源。
- 原始失败均保留：15 个 TDD RED、首个 PG 容器消失、TERM guard exit 53、裸 audit 官方 POST 暂时超时；没有把它们改写为“从未失败”。
- 非阻塞 notice：Vite 仍提示部分 chunk >500 kB；Playwright Chrome install 说明系统 Chrome 已存在且该安装步骤非 hermetic。
- 首个 PG 容器消失的根因无法从已 `--rm` 的容器取证，明确作为未知历史诊断，不影响 authoritative 容器全部门禁。
- 最终 concerns：无 release-blocking concern；push、npm 和 production 仍需独立控制器决策/授权。
