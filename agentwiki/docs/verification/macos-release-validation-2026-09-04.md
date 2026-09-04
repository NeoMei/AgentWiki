# AgentWiki macOS 全栈发布验证

日期：2026-09-04（Asia/Shanghai）

## 结论与代码身份

- 最终结论：**PASS**。
- 最终已测试代码提交：`23a25f888b76b9ce4b8a8cc76dd5164e1c80034b`（`fix(test): close macOS release verification gaps`）。
- 该 SHA 在无预存 `node_modules` / `dist`、未初始化 CodeGraph 的真实 clean clone 中完成锁定安装、完整 `pnpm test`、静态门禁、构建、裸审计和真实 CodeGraph；随后同一 SHA 在当前 clean worktree 完成隔离全栈与 Chrome Playwright 25/25。
- 本文件、最终修复报告与项目记忆位于代码提交之后的独立证据提交，不改变已测试代码；本任务未 push、未发布 npm、未部署生产。
- 没有因缺少 PostgreSQL、Redis、Playwright 或 CodeGraph 前提而跳过门禁；最终完整仓库保留的 3 个 skip 分别是显式 opt-in CodeGraph acceptance、macOS 上的 Windows OpenCode 可执行文件实跑和 macOS 上的 Windows ACL 断言。
- 下方“初始验证历史”保留此前 Task 1–6 的失败与修复；其旧 SHA/计数均是历史阶段证据，最终判断以后附的“最终审查修复波”为准。

## macOS 与工具链

- MacBook Air `Mac17,4`，Apple M5，10 核，32 GB，`arm64`。
- macOS 26.6.2（25G83）。
- Node.js v24.18.0；pnpm 11.9.0。
- Docker Desktop 4.89.0；Docker Engine 29.7.2。
- PostgreSQL 16.15；pgvector 0.8.6；Redis 7.4.11。
- Google Chrome 152.0.7977.76；Playwright 1.61.1。
- Prisma / `@prisma/client` 5.22.0（darwin-arm64）。
- CodeGraph CLI 1.6.0，独立可执行文件 `/Users/neomei/.npm-global/bin/codegraph`。
- 最终修复波显式使用 `PG_DUMP_BIN=/opt/homebrew/bin/pg_dump`；实际 client 16.14 (Homebrew)，server 16.15，同为 major 16，密码仅经环境传递。

## 初始验证历史（截至 `efb316ff0447b82d0875f2311678fd397bb34ab2`）

以下 Task 1–6 是最终审查之前的执行历史，为保留失败审计链而不改写；它们不是最终代码 SHA 的直接证明。

### Task 1：候选、安装与审计

- 初始候选为 `cc8a14d436eb02d7bd8ef4c746d38b9a6c1bb426`，当时 `master` 与 `origin/master` 同步且工作树清洁。
- `pnpm install --frozen-lockfile` exit 0：6 个 workspace project，首次解析/安装 1115 个包，lockfile supply-chain policy 检查 1221 entries；复跑为 `Already up to date`。
- `pnpm audit` exit 0，`No known vulnerabilities found`。
- 原始环境失败未隐藏：`corepack enable` 因 `/usr/local/bin/pnpm` symlink 权限得到 EACCES / exit 1；随后 `corepack prepare pnpm@11.9.0 --activate` exit 0，并确认 pnpm 11.9.0。
- 原始环境中 `docker version` 为 command not found / exit 127。用户在 Task 2 期间安装 Docker Desktop 后，验证才切换到计划要求的容器栈；此前 native PostgreSQL/Redis 尝试不计入 PASS。

### Task 2：disposable 数据服务

- PostgreSQL 容器 `5be29ed620498aac0330c9a1b039252eaab81569b43863a621d96cd2cad36b10`，镜像 `pgvector/pgvector:pg16`，只映射 `127.0.0.1:55432`；`pg_isready`、vector extension 0.8.6 与数据库身份检查通过。
- Redis 容器 `fab7d432f139e303cfff0c2e77e9eb5b8d08a0273c727edce571869aefb2cf86`，镜像 `redis:7.4-alpine`，只映射 `127.0.0.1:56379`；`PING=PONG`，`appendonly=yes`，`appendfsync=everysec`。
- Redis durability probe 写入/回读/删除成功；两次 `WAITAOF 1 0 1000` 均返回 1 个 local fsync。
- 两个容器均以 `--rm` 启动。被替代的 native 随机目录此前已可恢复地移至 `/Users/neomei/.Trash/agentwiki-native-services.7DurMQ`。

### Task 3：完整仓库门禁与隔离修复

### 原始失败与修复过程

- clean-tree 首跑：218 tests，163 pass / 54 fail / 1 skip。构建 runtime 依赖后的并行运行：218 pass / 42 fail / 1 skip；串行诊断：277 pass / 15 fail / 1 skip；隔离与 fixture 修复后：292 pass / 2 fail / 1 skip；随后 client 压测出现 1119 pass / 1 fail。
- 根因包括 runtime 构建顺序、database-global advisory lock 并发、Docker NAT 身份误判、pgvector/shared `public` 污染、server DB harness 缺口、真实 API fixture 漂移、Markdown canonical path、Windows path 模拟、OpenCode macOS 包解析，以及两个 20 万 Unicode 码点压力测试的默认超时。
- 旧 pgvector 测试曾把原始 `agentwiki_test.public` 迁移为 63 张表。现场没有被伪装或单独清理；后续全部验证改用逻辑数据库 `agentwiki_test_task3_20260904` 与随机前缀 schema。
- 审查前全仓已达到 4163 pass / 0 fail / 3 skip。审查修复又加入 clean-clone 编排、65 个 runtime 文件的 20 个非 DB 并行 + 45 个 DB 串行规划、protected inventory、schema-qualified HNSW 与 client 时序回归。
- TDD focused：两个 RED 命令分别为 3 fail 和 1 fail；focused unit 为 6 pass / 0 fail / 1 预期 DB skip；focused real DB 为 8 pass / 0 fail / 0 skip；client flaky 回归连续 5 次均 1/1。
- 无效 `git archive` 探针因缺少顶层 Git/runbook 得到 161 pass / 2 fail / 1 skip，未冒充 clean clone；首个真实 clone 在中间提交因 client 时序竞态失败 1 项，修复后才执行最终 clone。

### 最终门禁

- 最终真实 clean clone `pnpm test`：4173 tests，4170 pass / 0 fail / 3 skip。
  - runtime：302 tests，301 pass / 0 fail / 1 skip（并行 164 tests，163 pass；DB 串行 138/138）。
  - server：114 suites，1815 pass / 0 fail / 1 skip。
  - client：82 files，1120 pass / 0 fail / 0 skip。
  - sync-protocol：8 files，57 pass / 0 fail / 0 skip。
  - local-sync：61 files，877 pass / 0 fail / 1 skip。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、数据库/Redis missing-prerequisite skip gate 与 `git diff --check` 均 exit 0；build 只有 Vite `>500 kB` chunk warning。
- `pnpm audit` 的第一次同锁文件验证 exit 0；09:51、09:56 两次最终时刻复跑因 npm 官方 audit POST 三次超时而 exit 1，且最小 POST 同样超时。网络路径恢复后的最终裸 `pnpm audit` exit 0，`No known vulnerabilities found`；未改 lockfile，也未使用忽略 registry 错误的绕过参数。
- protected public inventory 最终 digest：`d78ab0b1f0708f8d72c170a6a756eeaeb20259d6058f36d092b6cf0232c4592f`，完整测试内多次 before == after。
- `agentwiki_test_task3_20260904.public` 最终 0 张表；`vector=0.8.6@public`；`hnsw.ef_search=200`；当时测试前缀 schema 残留为 0。

### Task 4：真实 CodeGraph

- 命令使用独立安装的 CodeGraph 1.6.0，未使用 mock，也未改写工作树已有 `.codegraph`。
- `AGENTWIKI_CODEGRAPH_E2E=1 AGENTWIKI_CODEGRAPH_BIN="$(command -v codegraph)" pnpm test:e2e:codegraph-standard-scan` exit 0：1 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo。
- 测试在临时 fixture 中验证 scanner/source 数据留在本地，确认前不 publish，确认后受控 RemoteSync seam 只收到 Preview bundle；这不是线上 AgentWiki 服务验收。

### Task 5：隔离全栈与 Playwright

### 原始失败与修复过程

- 第一条只读 psql 探针错误假定角色 `agentwiki`，以 `role does not exist` 失败；读取容器元数据后改用 `agentwiki_test`，在任何迁移前确认数据库名、public 0 张表和 vector 位于 public。
- 首次服务启动因测试限定的随机 `/tmp/agentwiki-mac-attachments.*` 被 attachment validator 拒绝；先看到回归 RED，再仅在 test 环境允许该精确随机目录。focused attachment：58/58。
- 第一次完整浏览器运行：8 passed / 4 failed / 13 did not run。修复 `LOCAL_SYNC_PACKAGE_VERSION=0.7.0` 和 test-only auth 限流隔离后，focused local-sync + onboarding 为 2/2。
- 动态 deployment seed 重 source 后变化，启动被持久化 identity 正确拒绝；改为固定测试 seed。根 `pnpm instance:rotate` 随后暴露 `@prisma/client` workspace 解析缺陷，原失败日志保留。
- 第二次完整浏览器运行：9 passed / 3 failed / 13 did not run，原因是同一分钟 focused + full 流量超过独立 API-IP 300 限额；加入严格受 loopback/test database/精确 `mac_e2e_*` schema 约束的 test-only 上限。
- 预审修复提交曾完成 25/25（46.2 秒）。审查后进一步强化限流隔离、删除 Space 的 graph refresh race、根 instance rotation 和进程组清理句柄。
- 审查修复 RED/GREEN：8 个无效限流隔离 case 在 RED 均错误放宽、GREEN 后 rate-limit 28/28；graph RED 观察到删除竞态日志、GREEN 9/9 且普通数据库错误仍记录；root rotate RED 为 `ERR_MODULE_NOT_FOUND`，GREEN 1/1。
- 最终 focused server command：3 suites、95/95；最终 root maintenance regression：1/1；server typecheck/lint/build 均 exit 0。审查前的全 server Jest 为 112 suites passed / 2 conditionally skipped，1816 pass / 5 conditionally skipped / 0 fail。

### 最终结果

- 迁移：49/49 migrations applied；隔离 schema 迁移后 64 张表，public 仍为 0。
- 根 `pnpm instance:rotate --confirm-new-deployment` exit 0；隔离 schema instance identity 从 `7ce5697f-c1e2-4588-873f-a8de5df0bd53` 变为 `0c2fcdf0-d049-4fbf-b194-f8d3e243a142`，成功 `instance.rotate` audit event 从 1 条增加为 2 条。
- Playwright collection：7 files / 25 tests。最终串行、单 worker、无 retry：25 passed / 0 failed / 0 skipped（1.6 分钟）。
- 最终 API health 的 status/database/redis/auditPersistence/attachmentStorage 全部 `ok`。日志扫描中 graph race、Unhandled、FATAL、ECONN、Prisma error 均为 0；API 只有通过负路径测试产生的 4 个 403、1 个 404、1 个 409。
- paid assistant fallback 始终关闭；没有使用外部业务 secret。

### Task 6：精确清理证据

### 进程组

- authoritative runtime 的 PGID / owner 为 `56712`；实时成员精确为 8 个：group owner `56712`，API/worker/client wrapper `56720/56721/56722`，worker/Vite/API/esbuild child `56748/56749/56750/56758`。
- 每个成员的 PGID、完整命令和 CWD 均与 Task 5 快照一致；CWD 只位于本 worktree 的 `agentwiki`、`apps/server` 或 `apps/client`。3000 listener 仅为 PID 56750，5173 listener 仅为 PID 56749。
- 两版自动 guard 曾因本任务匹配式错误在 PID 56749 产生假阴性 exit 52：第一版多写一层 `agentwiki/`，第二版漏掉命令前导 `node `。两次均在 TERM 前 fail closed；实时命令本身始终与快照一致。第三版使用精确完整命令重做全部 guard 后通过。
- `/bin/kill -TERM -56712` exit 0；等待后该 PGID 成员为 0，3000/5173 无 listener。

### schema、附件、容器和端口

- schema guard 只接受 `mac_e2e_[A-Za-z0-9_]*`；实际值 `mac_e2e_20260904110258_2487` 通过。精确 schema DROP 前数量 1，`DROP SCHEMA ... CASCADE` exit 0，DROP 后数量 0。
- 附件 guard 只接受 `/tmp/agentwiki-mac-attachments.*` 或 `/private/tmp/agentwiki-mac-attachments.*`；实际路径 `/tmp/agentwiki-mac-attachments.DLF925` 为非 symlink、mode 0700 的目录，含 2 个文件。
- 未使用 broad `rm`。附件目录已移动至可恢复位置 `/Users/neomei/.Trash/agentwiki-macos-release-task6.EP25nx/agentwiki-mac-attachments.DLF925`；原路径不存在，目标目录及 2 个文件存在。
- 停容器前遍历所有可连接数据库：`agentwiki_test`、`agentwiki_test_task3_20260904`、`postgres` 的 `^(mac_e2e|folder_test|markdown_test|collaboration_test|page_template_test|pgvector_test|sync_test)_` schema 数均为 0，总数 0。
- 第一次全库枚举脚本因 zsh 不默认按换行拆分变量而 exit 2，未执行到 stop，也未修改数据库；改为明确逐行数组后完整复核通过。
- 原始诊断污染只存在于 disposable 容器的 `agentwiki_test.public`（63 张表）；没有把它当成 clean，也没有在共享式运行期间单独删除。`--rm` PostgreSQL 容器消失时该现场随容器一并销毁。
- 停止前两个容器均 `running=true`、`auto_remove=true`，ID 与 Task 2 runtime 完全一致。`docker stop agentwiki-mac-redis agentwiki-mac-postgres` exit 0；随后两个容器均不可 inspect。
- 最终 3000、5173、55432、56379 均无 listener；Task 5 PGID 无成员；原附件路径不存在。

### 初始阶段发布判断（已被最终审查复验取代）

历史阶段曾针对 `e8c16e92822758a75350e50d9abb7865cc970f54` 判定 PASS；随后审查发现额外问题，因此该判断不再是最终发布依据。其原始执行事实保留如上，最终依据是下方代码提交 `23a25f888b76b9ce4b8a8cc76dd5164e1c80034b` 的直接复验。

---

## 最终审查修复波：TDD RED / GREEN

审查基线为 `efb316ff0447b82d0875f2311678fd397bb34ab2`，代码修复提交为 `23a25f888b76b9ce4b8a8cc76dd5164e1c80034b`，共 19 files、390 insertions、74 deletions。

1. Markdown 同目录 canonical path：真实 PostgreSQL RED 1/1，`pages/Project/Source.md` 的 `[[Target.md]]` 错误命中根目标；unit RED 另有 1 项。GREEN 后 source-relative exact query、根 canonical path 与 duplicate-title 冲突均正确，server focused 纳入 135/135，真实 DB 1/1。
2. 跨平台 launcher / migration timeout：RED 为 2 fail / 3 pass，证明 Windows `.cmd` shim 被错误当成 Node 脚本且缺少 timeout 边界。GREEN 后 JS entrypoint 由 `process.execPath` 启动，migration timeout 最大 90 秒并拒绝无效值；指定 server/instance/pgvector/Markdown/page-template/collaboration harness 不再直接 spawn `pnpm` / `npx`。launcher + server harness + instance focused 8/8，page-template DB 2/2，pgvector DB 4/4。
3. 附件 E2E 隔离：9 个无效隔离 case 在 RED 均错误放宽。GREEN 后附件例外与限流共同调用一个 fail-closed predicate，必须同时满足 `NODE_ENV=test`、API loopback、PostgreSQL loopback、数据库名含 `test`、恰好一个合法 `mac_e2e_*` schema；四个 server focused suites 合计 135/135。
4. protected inventory `pg_dump`：RED 1/1。GREEN 后要求绝对 `PG_DUMP_BIN`、`--version` 预检且 client/server major 相同、URI argv 无 password、仅用 `PGPASSWORD`，unit 1/1；真实 inventory 2/2。
5. periodic + queued graph race：periodic RED 1/1。GREEN 后两条路径共享精确 predicate，只忽略 `ForbiddenException('Space not found')`，其他错误继续记录；包含在 server focused 135/135。

RED 共 15 个失败 case（launcher 2、server 11、pg_dump 1、真实 Markdown DB 1），均先观察失败再写生产代码。GREEN 汇总：launcher/server-harness/instance 8/8、四个 server suites 135/135、pg_dump 1/1、Markdown DB 1/1、page-template DB 2/2、pgvector DB 4/4、protected inventory 2/2；server typecheck 与目标 lint exit 0。所有 focused schema residue 为 0，focused 前后 protected digest 均为 `79642c9fc9d560bdbadd4828bcb75b6796a0a56ec1c45638d1e6d9ddd2b0e2e3`。

## disposable PostgreSQL / Redis

- 端口启动前确认 55432 / 56379 无 listener、容器名无冲突。第一次 PostgreSQL `--rm` 容器 `c639038…` 在 readiness 期间自行消失；容器已自动删除、没有日志可证明根因，因此不把猜测写成结论，也不计作 PASS 证据。
- authoritative PostgreSQL 容器 ID `871bccd0242434e4a1f2535f25a9013cedcdef836219db406eecc8fd3ff09f04`，Redis 容器 ID `be51bd3dbf2b7f99a672ce5c595a4211d8f6dbeb96c729b5b49b7e0f8c8bc17b`；两者均 `--rm` / `auto_remove=true`，只绑定 `127.0.0.1:55432` / `127.0.0.1:56379`。
- PostgreSQL 使用专用数据库 `agentwiki_test_finalfix` 和专用测试角色；迁移前 `public` 0 张表，vector 0.8.6 位于 public，database `hnsw.ef_search=200`。
- Redis `PING=PONG`、`appendonly=yes`、`appendfsync=everysec`；SET/GET/DEL 成功，两次 `WAITAOF 1 0 1000` 均确认 1 个 local fsync。

## 最终代码 SHA 的真实 clean clone 门禁

- 使用 `git clone --no-local` 创建 `/private/tmp/agentwiki-mac-clean-clone-finalfix.DZor7f/repo`；HEAD 精确为 `23a25f888b76b9ce4b8a8cc76dd5164e1c80034b`，初始 status clean，无 `node_modules`，server/client/shared/sync-protocol/local-sync 无预存 `dist`。
- clone 内 `.codegraph` 只有 tracked `.gitignore`，没有可用 index；遵循仓库规则未运行 init。
- `pnpm install --frozen-lockfile` exit 0：6 workspace projects、1115 packages、lockfile supply-chain policy 1221 entries；npm registry 的短暂 TLS/socket 重试均由标准安装重试恢复，没有 bypass。
- 全部专用数据库变量、两个 Redis 变量和绝对 `PG_DUMP_BIN` 均显式配置。根 `pnpm test` exit 0：**4211 total = 4208 pass / 0 fail / 3 skip**。
  - runtime parallel：167 total，166 pass / 0 fail / 1 skip；runtime DB serial：139/139；runtime 合计 306 total，305 pass / 1 skip。
  - server：114 suites，1850 total，1849 pass / 0 fail / 1 skip。
  - client：82 files，1120/1120。
  - sync-protocol：8 files，57/57。
  - local-sync：61 files，878 total，877 pass / 0 fail / 1 skip。
- missing-prerequisite scan 对 `DATABASE_URL is not configured|TEST_DATABASE_URL is not configured|PostgreSQL is unavailable|Redis is unavailable` 为 0 matches；没有隐藏 skip/fail。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 与 `git diff --check` 均 exit 0；build 只有 Vite `>500 kB` chunk warning。
- 裸 `pnpm audit` 前 5 次均在官方 `/-/npm/v1/security/advisories/bulk` 的标准三次请求重试后 timeout / exit 1；最小 POST、IPv4、IPv6 和 HTTP/1.1 探针同样出现 0-byte timeout，证明是当时的外部 POST 路径。第 6 次仍使用原始裸命令、原 lockfile、原 npm registry，exit 0：`No known vulnerabilities found`；没有忽略或替代 registry。
- 完整 DB 门禁多次输出 `public_inventory_before == public_inventory_after == 79642c9fc9d560bdbadd4828bcb75b6796a0a56ec1c45638d1e6d9ddd2b0e2e3`；测试结束后测试前缀 schema 为 0，`agentwiki_test_finalfix.public` 仍为 0 张表。

## 真实 CodeGraph

- `AGENTWIKI_CODEGRAPH_E2E=1 AGENTWIKI_CODEGRAPH_BIN=/Users/neomei/.npm-global/bin/codegraph pnpm test:e2e:codegraph-standard-scan` exit 0：1 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo。
- 使用真实 CodeGraph 1.6.0，不是 mock；测试在自身临时 fixture 内扫描，私有 scanner/source 数据留在本地，确认前不 publish，确认后 RemoteSync seam 只收到 Preview bundle。

## 隔离全栈与 Chrome Playwright

- 唯一 schema `mac_e2e_20260904060632_46490`；附件根 `/tmp/agentwiki-mac-attachments.F8pAW8`；所有 secret 均为本轮生成或显式 test-only 值，`ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=false`。
- Prisma migrate deploy：49/49 migrations applied；schema 64 张表，public 仍为 0；Chrome install preflight exit 0（系统已有目标 Chrome）。
- API、worker、client 由独立 session/process-group owner `49952` 启动。health 的 status/database/redis/auditPersistence/attachmentStorage 均为 `ok`。
- `playwright test --list` exit 0：7 files / 25 tests。 `playwright test --workers=1 --retries=0` exit 0：25 passed / 0 failed / 0 skipped（47.2 秒）；`.last-run.json` 为 `passed`、`failedTests=[]`，没有 failure trace。
- `GRAPH_SWEEP_MS=2000`；完整浏览器运行后又等待 5 秒再扫日志，覆盖多个 periodic tick。graph race / sweep failure、Unhandled、FATAL、ECONN、Prisma error 均为 0。
- API 日志只有负路径用例预期产生的 4 个 403、1 个 404、1 个 409；最终 health 仍全 `ok`。

## 精确清理证据

- 清理前 PGID 49952 精确有 8 个同用户成员：owner 49952，pnpm wrappers 49955/49956/49957，API/Vite/worker/esbuild 49968/49977/49986/49992。逐项 command、PGID、UID 与 CWD guard 通过；CWD 仅为本 worktree 的 `agentwiki`、`apps/server`、`apps/client`；3000/5173 listener 仅为 49968/49977。
- 第一版 TERM guard 因 zsh 未拆分 PID 字符串而 exit 53，发生在 signal 前，资源未改变；改成显式 zsh 数组后全部即时 guard 通过。`/bin/kill -TERM -49952` exit 0；PGID 成员 8→0，3000/5173 清空。
- schema 名字通过精确 `mac_e2e_[A-Za-z0-9_]*` guard，DROP 前精确数量 1、DROP 后 0。附件根为非 symlink、0700、UID 501，含 2 个文件；未 broad `rm`，已移至可恢复路径 `/Users/neomei/.Trash/agentwiki-macos-finalfix.pG4uH2/agentwiki-mac-attachments.F8pAW8`，原路径不存在且目标 2 文件仍在。
- 停容器前遍历所有可连接数据库 `agentwiki_test_finalfix`、`postgres`：`^(mac_e2e|folder_test|markdown_test|collaboration_test|page_template_test|pgvector_test|sync_test)_` schema 总数 0；public 仍为 0。
- 两容器在 stop 前再次以 full ID 验证 `running=true`、`auto_remove=true`、名称和 loopback port mapping；按 full ID stop exit 0，随后两个 full ID 的 inspect 均 exit 1，两个容器名匹配数 0。
- 最终 PGID 49952 无成员，原附件路径不存在，3000 / 5173 / 55432 / 56379 均无 listener。clean clone 清理 guard 第一版因误用 zsh 只读变量名 `status` 在移动前 exit 1；第二版确认精确路径、非 symlink、HEAD、clean status、CWD process 0 后，将其可恢复地移至 `/Users/neomei/.Trash/agentwiki-macos-clean-clone.JcE6tM/agentwiki-mac-clean-clone-finalfix.DZor7f`，原路径不存在。

## 发布判断

针对代码提交 `23a25f888b76b9ce4b8a8cc76dd5164e1c80034b`，最终 required gates 均有零失败证据，外部前提齐全，三项 skip 均不是缺失数据库/Redis/Playwright/CodeGraph，隔离资源已精确清理，因此 macOS 发布验证结论为 **PASS**。这不是 npm 发布或生产部署证据；本任务按最终审查要求保持未 push，交由控制器做整分支终审。
