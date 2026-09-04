# AgentWiki macOS 全栈发布验证

日期：2026-09-04（Asia/Shanghai）

## 结论与代码身份

- 最终结论：**PASS**。
- 已测试代码提交：`e8c16e92822758a75350e50d9abb7865cc970f54`。
- 本文件及项目记忆作为上述代码提交之后的独立证据提交追加，不改变已测试代码。
- 验证覆盖锁定安装与依赖审计、disposable PostgreSQL/pgvector、Redis AOF、完整仓库门禁、真实 CodeGraph standard scan、隔离全栈服务与真实 Chrome Playwright 25/25，以及精确资源清理。
- 没有因缺少 PostgreSQL、Redis、Playwright 或 CodeGraph 前提而跳过发布门禁；保留的 3 个全仓 skip 分别是显式 opt-in 的 CodeGraph acceptance、macOS 上的 Windows OpenCode 可执行文件实跑、macOS 上的 Windows ACL 断言。

## macOS 与工具链

- MacBook Air `Mac17,4`，Apple M5，10 核，32 GB，`arm64`。
- macOS 26.6.2（25G83）。
- Node.js v24.18.0；pnpm 11.9.0。
- Docker Desktop 4.89.0；Docker Engine 29.7.2。
- PostgreSQL 16.15；pgvector 0.8.6；Redis 7.4.11。
- Google Chrome 152.0.7977.76；Playwright 1.61.1。
- Prisma / `@prisma/client` 5.22.0（darwin-arm64）。
- CodeGraph CLI 1.6.0，独立可执行文件 `/Users/neomei/.npm-global/bin/codegraph`。

## Task 1：候选、安装与审计

- 初始候选为 `cc8a14d436eb02d7bd8ef4c746d38b9a6c1bb426`，当时 `master` 与 `origin/master` 同步且工作树清洁。
- `pnpm install --frozen-lockfile` exit 0：6 个 workspace project，首次解析/安装 1115 个包，lockfile supply-chain policy 检查 1221 entries；复跑为 `Already up to date`。
- `pnpm audit` exit 0，`No known vulnerabilities found`。
- 原始环境失败未隐藏：`corepack enable` 因 `/usr/local/bin/pnpm` symlink 权限得到 EACCES / exit 1；随后 `corepack prepare pnpm@11.9.0 --activate` exit 0，并确认 pnpm 11.9.0。
- 原始环境中 `docker version` 为 command not found / exit 127。用户在 Task 2 期间安装 Docker Desktop 后，验证才切换到计划要求的容器栈；此前 native PostgreSQL/Redis 尝试不计入 PASS。

## Task 2：disposable 数据服务

- PostgreSQL 容器 `5be29ed620498aac0330c9a1b039252eaab81569b43863a621d96cd2cad36b10`，镜像 `pgvector/pgvector:pg16`，只映射 `127.0.0.1:55432`；`pg_isready`、vector extension 0.8.6 与数据库身份检查通过。
- Redis 容器 `fab7d432f139e303cfff0c2e77e9eb5b8d08a0273c727edce571869aefb2cf86`，镜像 `redis:7.4-alpine`，只映射 `127.0.0.1:56379`；`PING=PONG`，`appendonly=yes`，`appendfsync=everysec`。
- Redis durability probe 写入/回读/删除成功；两次 `WAITAOF 1 0 1000` 均返回 1 个 local fsync。
- 两个容器均以 `--rm` 启动。被替代的 native 随机目录此前已可恢复地移至 `/Users/neomei/.Trash/agentwiki-native-services.7DurMQ`。

## Task 3：完整仓库门禁与隔离修复

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

## Task 4：真实 CodeGraph

- 命令使用独立安装的 CodeGraph 1.6.0，未使用 mock，也未改写工作树已有 `.codegraph`。
- `AGENTWIKI_CODEGRAPH_E2E=1 AGENTWIKI_CODEGRAPH_BIN="$(command -v codegraph)" pnpm test:e2e:codegraph-standard-scan` exit 0：1 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo。
- 测试在临时 fixture 中验证 scanner/source 数据留在本地，确认前不 publish，确认后受控 RemoteSync seam 只收到 Preview bundle；这不是线上 AgentWiki 服务验收。

## Task 5：隔离全栈与 Playwright

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

## Task 6：精确清理证据

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

## 发布判断

针对提交 `e8c16e92822758a75350e50d9abb7865cc970f54`，本清单所有必须门禁均有零失败的最终证据，外部前提没有缺失，隔离资源已按精确 ownership/路径 guard 清理，因此 macOS 全栈发布验证结论为 **PASS**。本记录不代表 npm 发布或生产部署，也没有执行 push；后续由控制器完成分支终审与推送决策。
