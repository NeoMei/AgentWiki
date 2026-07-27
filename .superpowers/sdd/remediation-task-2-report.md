# Task 2 整改报告：保留遗留凭据撤销与来源历史

## Status

`fixed`

## Patch contract

- 不修改任何已执行迁移。`20260727010000_remove_legacy_user_api_key` 与 `20260727011000_align_memory_hash_canonicalization` 在第二轮复审中均保持字节不变；新增 `20260727009000_prepare_memory_hash_canonicalization` 与 `20260727012000_restore_memory_hash_canonicalization`，组成对既有迁移的前向兼容桥。
- 09000 先按最终 ASCII-only 规则拒绝真实冲突；仅对会被既有 10000 的 PostgreSQL `lower()` / `\s` 规则误判为冲突的行，暂时把 `type` 改为逐行唯一桥接值，并在独立表保存原值。10000、11000 完成后，12000 再按原 `type` 复核、恢复 `type`、计算最终 hash 并删除桥表。整个链不修改 `content`，也不永久修改上下文字段。
- 前向迁移在同一显式事务中先锁定 `User`、输出非空 `apiKey` 计数和强制轮换提示、清空值，再删除索引和列；Prisma schema 同步移除字段。
- Memory 哈希采用 locale-independent 规范：只折叠/trim ASCII space 与 U+0009–U+000D，只把 ASCII `A-Z` 转为 `a-z`，FEFF、U+0130、NBSP 等非 ASCII 码点原样保留。第 15 个迁移锁定 `AgentMemory`，先按唯一键维度计算规范哈希冲突；存在冲突时报告组数/行数并抛错，整个事务回滚，不删除或自动合并 Memory。
- 恢复工具先比较 URL host/port/database，再连接源/目标查询 `current_database()`、`inet_server_addr()`、`inet_server_port()`；IPv4/IPv6 loopback 规范为同一身份，因此 `localhost` 与 `127.0.0.1` 不能绕过物理同库拒绝。URL 不写入输出或错误。
- CLI 默认 dry-run；只有 `--apply` 写入。所有 legacy 表读取先执行 `SET TRANSACTION READ ONLY`。每个 legacy Job 在独立目标事务和 advisory lock 下重新读取目标状态，目标 interactive transaction 显式使用 `maxWait=10s`、`timeout=120s`。
- 确定性构造 `SourceVersion`、`SourceFileSnapshot`、最小 `Evidence` 以及 Page 的 `sourceId` / `sourceVersionId` / `sourcePath`。只有真实存在于 snapshot bundle 的路径才写入 `Page.sourcePath`；未映射 Page 保持 NULL，fallback 的 `linkStrategy` / `requestedPath` 仅写入独立的 `Evidence.location`。恢复所需的 `Source` 和 `IngestRun` 缺失时也以兼容旧迁移的 ID 创建。
- `SourceFileSnapshot` 没有 content 列；所有原始快照内容保存在 `SourceVersion.content` 的 `agentwiki/legacy-codebase-snapshot-bundle@1` JSON 中，以排序后的 `filesByPath[path] -> { legacySnapshotId, contentHash, content, contentChecksum }` 保留可逆映射。
- ID 使用 legacy Job/Page/path 输入的 SHA-256 截断值，bundle hash 使用完整 SHA-256；排序使用固定 Unicode 码点比较，不依赖宿主 locale。重复运行只识别相同记录，不再写入。
- 缺失 Space/Page、重复 snapshot path、重复计划 Page source path、实体唯一键/身份冲突和现有不同 Page provenance 均进入结构化冲突报告；`--apply` 对该 Job 零写入，不覆盖新 provenance。

## 实现

- 新增 `agentwiki/scripts/recover-legacy-document-data.mjs`：
  - 使用服务端现有 Prisma Client；源库仅以参数化 raw query 读取 legacy 表，目标使用当前 Prisma 模型。
  - 从 `DocumentGenerationJob`、`CodebaseSnapshot` 和 `Page.documentGenerationJobId` 构造恢复计划。
  - Page path 只有在 legacy result 显式路径真实存在于 bundle 时才得到 confidence 1，并在 Evidence location 写同一 `bundlePath`。显式路径不存在时 `Page.sourcePath` 与 `Evidence.location.sourcePath` 均保持 NULL，只在 Evidence 记录 `legacy-result-path-missing-snapshot`、原请求路径、`bundlePath: null` 与 0.25 confidence；单快照推断 confidence 为 0.75。
  - apply 事务中先重新检测所有冲突；Page 用旧 provenance 值作乐观 `updateMany` 条件，按 100 项批次执行，任一计数不是 1 时回滚整个 Job。
  - stdout 只输出模式、计数、资源 ID 与冲突类型；未知数据库错误只输出错误码，不输出 Prisma error/连接串。
- 最终包含 21 项恢复 Node runtime 测试和 8 项真实 PostgreSQL runtime 测试，覆盖 URL/物理隔离、READ ONLY、dry-run/apply、确定性 bundle、provenance、250 Page 规模、幂等、冲突、13→17 真实 Prisma 链、凭据回滚、错误 Evidence、凭据不泄露和运维步骤。
- `design/OPERATIONS.md` 增加 PAT/Memory 迁移前检查，以及 pre-migration backup 恢复到隔离数据库 → dry-run → apply → 幂等复跑 → SourceVersion/SourceFileSnapshot/Evidence/Page 计数和 provenance 查询。

## TDD RED / GREEN 证据

以下命令均在 `/Users/neomei/项目/codexprojects/AgentWiki /agentwiki` 执行，并先设置：

```bash
export PATH="/Users/neomei/Library/pnpm/bin:$PATH"
```

测试命令：

```bash
node --test scripts/recover-legacy-document-data.test.mjs
```

- URL 隔离 / 默认 dry-run RED：`2 failed, 0 passed`，两个导出均为 `undefined`。实现后 GREEN：`2 passed`。
- 确定性 bundle RED：`1 failed, 2 passed`，`buildJobRecoveryPlan` 为 `undefined`。实现后 GREEN：`3 passed`。
- 幂等与 Page provenance RED：`2 failed, 3 passed`；重复运行仍计划创建 Source，且不同新 provenance 未报告冲突。实现后 GREEN：`5 passed`。
- Memory / 前向迁移 RED：`2 failed, 5 passed`；规范哈希函数缺失，迁移文件不存在。实现函数、事务 SQL 与 schema 调整后 GREEN：`7 passed`。中间一次测试只因断言未接受安全的 `DROP COLUMN IF EXISTS` 而失败，收窄为语义断言后通过，不计作产品 RED。
- dry-run/apply 执行边界 RED：`2 failed, 7 passed`，执行函数不存在。实现后 GREEN：`9 passed`，dry-run 零目标事务/零写，apply 每 Job 一个目标事务。
- CLI 凭据保护 RED：`1 failed, 9 passed`，脚本直接运行错误退出码为 0。增加入口后 GREEN：`10 passed`，同库在建连前拒绝，stdout/stderr 均不含测试密码。
- 数据完整性 RED：`3 failed, 10 passed`；重复 snapshot path、重复 Page source path、缺失 Space 均未阻断。实现结构化冲突后 GREEN：`13 passed`。
- OPERATIONS 契约 RED：`1 failed, 13 passed`，缺少隔离恢复流程。补齐 runbook 后 GREEN：`14 passed`。
- 跨 locale 确定性 RED：`1 failed, 14 passed`；反转 `localeCompare` 会改变 bundle 顺序和 SHA-256。改为固定码点比较后 GREEN：`15 passed`。

最终全 runtime：

```bash
pnpm test:runtime
```

初次整改结果：`23 passed, 23 total`；复审最终结果见下方追加记录。

## Prisma 与本地数据库验证

- 迁移前只读查询：`User.apiKey IS NOT NULL` 计数为 `0`，本机无需遗留 PAT 轮换；规范 Memory hash 冲突组数为 `0`。
- 初次 `prisma migrate status`：发现 14 个迁移，仅 `20260727010000_remove_legacy_user_api_key` 待执行，按 Prisma 约定退出 1。
- `pnpm --filter @agentwiki/server exec prisma migrate deploy`：exit 0，新迁移成功应用。
- 初次迁移后 `prisma migrate status`：exit 0，`Database schema is up to date!`，14/14 已应用。
- 迁移后 SQL：`apiKey_columns=0`、`apiKey_indexes=0`、`memory_hash_mismatches=0`。
- `pnpm --filter @agentwiki/server exec prisma validate`：schema valid。
- `pnpm --filter @agentwiki/server exec prisma generate`：Prisma Client 5.22.0 生成成功。
- 复审前 14 个已执行迁移目录的 `git diff --name-only` 为空，未编辑任何已执行迁移。

## 服务端验证

- `pnpm --filter @agentwiki/server typecheck`：exit 0。
- 初次 `pnpm --filter @agentwiki/server test`：`20 passed` suites，`105 passed` tests；复审最终为 108 tests。
- `git diff --check`：exit 0。

## 变更文件

- `.superpowers/sdd/remediation-task-2-report.md`
- `agentwiki/apps/server/prisma/schema.prisma`
- `agentwiki/apps/server/prisma/migrations/20260727009000_prepare_memory_hash_canonicalization/migration.sql`
- `agentwiki/apps/server/prisma/migrations/20260727010000_remove_legacy_user_api_key/migration.sql`
- `agentwiki/apps/server/prisma/migrations/20260727011000_align_memory_hash_canonicalization/migration.sql`
- `agentwiki/apps/server/prisma/migrations/20260727012000_restore_memory_hash_canonicalization/migration.sql`
- `agentwiki/apps/server/src/memory/memory.service.ts`
- `agentwiki/apps/server/src/memory/memory.service.spec.ts`
- `agentwiki/scripts/legacy-migration-db.test.mjs`
- `agentwiki/scripts/recover-legacy-document-data.mjs`
- `agentwiki/scripts/recover-legacy-document-data.test.mjs`
- `design/OPERATIONS.md`

## 复审整改追加记录

### TDD RED / GREEN

- ASCII-only Memory RED：`memory.service.spec.ts` 输出 `3 failed, 8 passed`，规范函数不存在；Node runtime 的 FEFF 用例输出 `1 failed, 14 passed`，旧 `\s`/`toLowerCase` 错误吞掉 FEFF/改变 U+0130。实现后 Jest `11 passed`。
- 第 15 个迁移 RED：专用 runtime 输出 `1 failed, 15 passed`，迁移文件为空。增加 collision-first 前向迁移后通过。
- 物理同库 / READ ONLY RED：专用 runtime 输出 `2 failed, 15 passed`，没有物理身份拒绝，READ ONLY statement 列表为空。实现后 `17 passed`。
- provenance / runbook RED：专用 runtime 输出 `3 failed, 15 passed`，缺少 `contentChecksum`，不存在 snapshot 的显式路径仍伪装为高置信，文档没有逐路径 checksum。实现并修正测试控制后 `18 passed`。
- 事务规模 RED：专用 runtime 输出 `2 failed, 17 passed`，目标事务 options 为 `undefined`。增加 120 秒 timeout、100 项 Page batch 和 250 Page 用例后 `19 passed`。
- 真实数据库首次 RED：

  ```bash
  node --test scripts/legacy-migration-db.test.mjs
  ```

  结果 `2 failed, 2 passed`。PostgreSQL `E'\\v'` 未覆盖 vertical tab，导致 SQL/JS ASCII hash 不同；`inet_server_addr()` 返回 `::1/128` 与 `127.0.0.1/32`，旧比较未规范 CIDR/loopback。改用 SQL `E'[ \\x09-\\x0D]+'`、应用 `[ \\x09-\\x0D]+`，并剥离 CIDR/规范 loopback 后 GREEN：`4 passed`。
- 物理同库 CLI 消息 RED：真实 DB 测试输出 `1 failed, 3 passed`，CLI 只返回泛化失败文本。仅放行不含 URL 的已知 physical-identity 消息后 GREEN：`4 passed`；stdout/stderr 同时断言不含 URL 与数据库密码。

### 真实 PostgreSQL 验证

- 随机隔离 schema 实际执行 `20260727010000`：插入一项非空 PAT，迁移 stderr 先输出 count 1 与 rotate warning；迁移后 `apiKey` 列数 0，User 行仍为 1。
- 随机隔离 schema 实际执行 `20260727011000`：ASCII whitespace、FEFF、U+0130、NBSP 四项 SQL hash 与应用固定 MD5 全部一致。
- 两项会规范为同一 hash 的 Memory 实际触发 migration exception；新连接回读仍为 2 行、`old-a,old-b`，证明事务完整回滚且未删除。
- 使用 `localhost` 与 `127.0.0.1` 两个真实 Prisma 连接到同一库，连接后物理身份检查拒绝且错误不含 URL。
- public schema 新规范冲突组为 0；`prisma migrate deploy` 成功应用第 15 个迁移；最终 `prisma migrate status` 为 15/15 up to date，post-migration hash mismatch 为 0。
- OPERATIONS 的两条 LEFT JOIN / NULL-safe checksum 与 provenance SQL 已直接交给本地 PostgreSQL 执行，exit 0、返回零行。

### 最终门禁

- 带本地 `DATABASE_URL` 的 `pnpm test:runtime`：`30 passed, 30 total`，4 项 DB 测试均实际执行、无 skip。
- `prisma validate`、`prisma generate`：exit 0；Prisma Client 5.22.0 生成成功。
- `prisma migrate status`：15/15 up to date。
- 服务端 typecheck：exit 0。
- 服务端 Jest：`20 passed` suites，`108 passed` tests。

## 第二轮复审整改追加记录

### 13→17 前向迁移链

- 产品 RED：在随机隔离 schema 中先用只包含原 13 个目录的临时 Prisma schema 执行 `migrate deploy`，插入非空测试 PAT 与同上下文的 ASCII `i` / U+0130 `İ` 后，再部署 workspace latest；既有 10000 因旧 `lower()` 规则误碰撞而失败，证明 13→latest 链不可达。
- 首次尝试创建独立数据库时环境返回 `permission denied to create database`；这不是产品 RED。测试改用随机隔离 PostgreSQL schema、独立 `_prisma_migrations` 和 schema 专用 URL，仍执行真实 Prisma deploy/status，不降低验证强度。
- GREEN：09000 在最终 ASCII 规则下先拒绝真实冲突，再隔离旧规则假冲突；12000 恢复上下文并删除桥表。真实 13→17 链验证 `apiKey` 列为 0、桥表为 0、成功迁移数为 17，Memory 原文 UTF-8 hex 仍为 `69` / `c4b0`，`type` 均恢复为 `semantic`，最终 hash 分别为 `865c0c0b4ab0e063e5caa3387c1a8741` / `1a313f370a5ba8fd5dad6f793d84ff21`。
- 真实冲突反例：原 13 个迁移后插入非空 PAT 与 `A<TAB>B` / `a b`，workspace deploy 在 09000 失败；回读确认 `apiKey` 列和值仍在、两行 `type`/`contentHash` 未变、桥表不存在、成功迁移仍为 13。直接执行 09000 同时返回 `canonical memory hash conflict`。
- 既有 10000 组合回滚：在同一隔离 schema 同时放入非空 PAT 与真实 Memory 冲突，直接执行其冻结 SQL 后失败；新连接确认 PAT 列和值、两条 Memory 内容/hash 和迁移前状态全部保留。
- 已执行迁移字节校验：10000 SHA-256 为 `8f001a52d16c2e1c2f3288af95b4a9b3f24010c6bc3565f35d5488aa75996d68`，11000 为 `56726d32b0b5b21c289872e55c3e3d84710418c6e60b94cc09b5fd6815fa236a`，均与第二轮开始时一致。新增且随后在本地执行冻结的 09000 / 12000 分别为 `6ca72f31c0381a7341d13df8953e6105978d72a8b95e93936ae98007a9df2e43` / `12fe753c8d756cb6aa565c04a5219f57071773a127c81aeab919a321eeaba9de`。

### provenance 与 Evidence

- 产品 RED：新增的 sourcePath / Evidence 专测最初为 `5 failed, 16 passed`。未映射 Page 仍收到 `legacy/pages/<pageId>.md` 假路径，同一关联但 location 或 confidence 错误的 Evidence 被当作幂等，target loader 也未读取这两个字段。
- GREEN：未映射 Page 的 `sourcePath` 保持 NULL；多个 NULL 不参与重复路径或唯一键碰撞判断。Evidence 的独立 `linkStrategy` / `requestedPath` 保留 fallback 语义。location 与 confidence 均纳入 Evidence 身份比较，`loadTargetState` 同步选择两个字段；恢复专测最终 `21 passed`。
- OPERATIONS 产品 RED：Node 契约与真实 PostgreSQL 反例最初 `2 failed, 26 passed`，因为缺少可执行的两侧 provenance 校验块，旧查询也会漏掉 Page 缺 Evidence 的断边。
- GREEN：runbook 的完整关联计数要求 `Evidence.location.sourcePath` 与 `Page.sourcePath` NULL-safe 相等；高置信 `bundlePath` 必须非空并等于 Page path，且必须存在于 `filesByPath`。两侧 `LEFT JOIN` 校验同时覆盖错误 location、错误 confidence、missing Page、missing Evidence、NULL SourceVersion 和 Source/Version 不一致。
- 真实错误 Evidence 测试直接从 OPERATIONS 标记块提取并执行 SQL，准确返回 `evidence_source_path_mismatch`、`evidence_confidence_mismatch`、`evidence_missing_page`、`page_missing_evidence`、`page_missing_source_version` 五类反例；同一 SQL 在当前 public schema 返回 0 行。

### 第二轮最终门禁

- 带本地 `DATABASE_URL` 的根级 `pnpm test`：runtime `37/37`，其中真实 PostgreSQL `8/8` 且无 skip；服务端 Jest `20/20` suites、`108/108` tests；客户端 Vitest `4/4`。
- Memory 专测：`11/11`。ASCII whitespace 正则改为语义相同的动态 RegExp 后，lint 从本次新增的 `no-control-regex` error 变为 `0 error`；剩余 6 条 unused-import warning 是既有文件。
- `pnpm typecheck`、`pnpm build`：exit 0。
- `prisma validate`、`prisma generate`：exit 0；Prisma Client 5.22.0 生成成功。
- 第二轮部署前 ASCII Memory 冲突组为 0；`migrate deploy` 成功应用 09000/12000；最终 `migrate status` 为 17/17 up to date。
- 迁移后 SQL：`successful_migrations=17`、`api_key_columns=0`、`bridge_tables=0`、`memory_hash_mismatches=0`；OPERATIONS provenance 校验返回 0 行。
- `git diff --check` 在 amend 前最终执行，结果记录于提交交付状态。

## 最终 OPERATIONS SQL Important

- 产品 RED：真实 PostgreSQL focused test 为 `0 passed, 1 failed`。原标记 SQL 对 reviewer 构造的 `linkStrategy=NULL, confidence=NULL` 与 `single-snapshot, confidence=0.75, bundlePath=NULL` 均未返回问题；单独 `confidence=NULL` 也只被归为泛化 confidence mismatch。原完整关联计数还可能把策略与 confidence 同为 NULL、但路径恰好匹配的 Evidence 计为 fully linked。
- `LEGACY_FULLY_LINKED_COUNT` 现显式要求非 NULL `linkStrategy` / `confidence`，只接受 `legacy-result` 与 `single-snapshot`，并要求 Page/source/bundle 路径非空、相等、存在于 `filesByPath`，`requestedPath` 为 NULL，confidence 分别精确为 `1` / `0.75`。
- `LEGACY_PROVENANCE_VALIDATION` 现先独立报告 NULL strategy 与 NULL confidence，再执行互斥策略矩阵：两种 mapped 策略要求非空且一致的 Page/source/bundle 路径；`legacy-result-path-missing-snapshot` 要求三处路径均为 NULL、confidence `0.25`、非空 `requestedPath`；`synthetic-page-link` 要求三处路径与 `requestedPath` 均为 NULL、confidence `0.5`。
- 真实 PostgreSQL GREEN：先插入四种完全正确的 Evidence，标记 SQL 返回 0 行；随后注入 reviewer 两个反例、单独 NULL confidence、错误 fallback path、missing/extra requestedPath、错误 location/confidence 与断边，SQL 分别返回明确 problem；完整关联计数仍为 `2`，没有把任何坏数据或 fallback 算作 fully linked。
- Focused runtime：OPERATIONS 实库反例与 runbook 契约 `2/2`。最终根级 `pnpm test` 为 runtime `37/37`（数据库测试无 skip）、服务端 Jest `108/108`、客户端 Vitest `4/4`。
- 从文档标记块直接提取 SQL 在当前 public schema 执行：`provenance_validation_rows=0`、`fully_linked_count=0`。本次 Important 只修改 OPERATIONS、其 runtime 测试和本报告，没有修改任何迁移或恢复实现。

## 外部阻塞 / 剩余验证

- 当前环境没有配置 `LEGACY_DATABASE_URL`，也没有在本机恢复可读取的 pre-migration legacy 数据库，因此没有对真实历史备份执行 recovery dry-run / apply。恢复规划、事务、幂等与冲突边界已用有状态 Prisma client doubles 验证；真实备份恢复后的计数与 provenance 验证必须按 `design/OPERATIONS.md` 在隔离库上完成。
- 本机当前目标数据库已实际应用 17/17 迁移并通过 post-migration SQL 校验；上述缺口仅限外部真实 legacy source 数据验证，不阻塞代码与目标 schema 整改。
