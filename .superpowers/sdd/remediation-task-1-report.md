# Task 1 整改报告：保护 Review 回滚与安全控制

## Status

`fixed`

## Patch contract

- 漏洞路径 1：`ReviewController.revert` 调用 `ReviewService.revert`；旧实现只按资源 ID 回滚，旧 ChangeSet 可以覆盖后续页面变更或删除/恢复后续关系状态。
- 安全不变量 1：`create_page`、`update_page`、`archive_page`、`create_relation`、`archive_relation` 的回滚必须由该 ChangeSet 仍持有且资源未在发布后变更；归档关系的 Evidence 只有在 `targetRelationId = null` 时才能重新绑定。任一条件变更计数不是 1 时，在 Prisma 事务内抛出 `CHANGESET_CONFLICT`。
- 保留行为 1：未发生后续变更的已发布页面和关系仍能合法回滚；未发布的 ChangeItem 仍跳过。
- 漏洞路径 2：全局 `RateLimitGuard` 在 auth 路由上优先使用任意 `x-api-key` 建桶，攻击者可轮换随机 key 绕过 10 次认证限制。
- 安全不变量 2：pathname 为 `/api/auth` 或以 `/api/auth/` 开头时仅使用规范化客户端 IP；query 不参与路由分类，非 auth 的 API key 继续使用哈希凭据桶和 120 次限制。
- 漏洞路径 3：`AuditService.record` 捕获持久化错误后只记录日志并返回成功，调用方无法感知审计缺口。
- 安全不变量 3：审计优先写数据库；数据库失败时必须用稳定 audit ID 写入无 TTL 的 Redis pending hash，并由 Redis 7 `WAITAOF 1 0 1000` 确认至少一次本地 AOF fsync。只有获得该确认才算 fallback 成功；DB 失败且 Redis 不支持 `WAITAOF`、AOF 未启用、超时或确认数不足时抛带两项 cause 的 `AggregateError`。`HSET` 已成功但 fsync 未确认时 pending 仍保留重试。

## 实现

- 页面回滚使用 `spaceId`、ChangeSet 来源/最后修改归属、预期删除状态及 `updatedAt <= publishedAt` 的条件 `updateMany`。
- 创建关系回滚使用 `sourceChangeSetId` 与 `lastModifiedAt <= publishedAt` 的条件 `deleteMany`；归档关系恢复使用 `createMany({ skipDuplicates: true })`，Evidence 使用 `id + targetRelationId: null` 的条件更新；两类返回计数都必须为 1。
- 新增 `CHANGESET_CONFLICT` 业务错误码，HTTP 状态为 409。
- rate-limit 用 URL parser 提取 pathname；auth 路由在读取 key 后仍强制选择规范化 IP 身份，规范化 IPv4-mapped IPv6、loopback、大小写/空白和 zone suffix。非 auth key 仍用 SHA-256 截断身份。
- `RedisService` 新增不吞异常的 hash 原语与 `setDurableHashField`；后者在同一 ioredis 连接上按顺序执行 HSET 和 `WAITAOF`，并严格校验返回的本地 fsync 数。当前 `ioredis@5.11.1` 通过已类型化的 `call(command, ...args)` 直接发送 Redis 命令，因此不存在客户端兼容性阻塞。启动与 `/api/health` 都会检查 `aof_enabled:1`，再用随机 `audit:durability-probe:<UUID>` 完整执行 HSET + WAITAOF + HSCAN 回读 + HDEL + WAITAOF；任一 ACL、回读或 fsync 失败都 fail closed，并在 finally 路径尝试持久清理 probe。应用不执行 `CONFIG SET`。
- `AuditService` 启动时立即 drain，之后每 30 秒轮询，模块销毁时停止；并发 drain 复用同一 Promise。服务跨轮保留 HSCAN 游标，短暂错误保留 pending 但游标继续前进；坏 JSON 和永久 Prisma 错误先持久写入 `audit:dead` 并确认 AOF，然后才删除 pending。`P2002` 视为已落库并确认删除。
- Compose 新增 `redis:7.4-alpine`，显式启用 `appendonly yes` / `appendfsync everysec` 并挂载 `redis-data:/data`；后端健康检查请求全局 `api` prefix 下的 `/api/health`。静态 runtime 契约从 `main.ts`、`health.controller.ts` 和 Compose 各自提取 prefix/path/URL 并断言组合路径一致。生产要求、ACL 和排查流程记录在 `docs/operations/redis-audit-durability.md`。
- 删除触及文件中的未使用 Nest import。

## TDD RED / GREEN 证据

以下命令均在 `/Users/neomei/项目/codexprojects/AgentWiki /agentwiki` 执行，并先设置：

```bash
export PATH="/Users/neomei/Library/pnpm/bin:$PATH"
```

### Review rollback

RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/review/review.service.spec.ts
```

关键输出：`Test Suites: 1 failed`，`Tests: 7 failed, 6 passed`。三个 page 冲突和两个 relation 冲突均显示 `Received promise resolved instead of rejected`；合法控制显示实际 mutation 仅按 ID，缺失归属与发布时间条件。

GREEN（最小实现后）：同一命令输出 `Test Suites: 1 passed`、`Tests: 13 passed`。补强合法 update/archive page 与 archive relation 控制及条件变异断言后输出 `Tests: 16 passed, 16 total`。

复审 Evidence RED：同一命令输出 `Tests: 2 failed, 15 passed`。合法恢复缺少 `targetRelationId: null` 条件；Evidence 已绑定 `relation-2` 时旧实现仍抢占并 resolve。GREEN：条件计数纳入同一事务后 `Tests: 17 passed`。随后新增有状态 transaction fake，证明第一项 page/ChangeItem/ChangeSet 已变更、第二项冲突时完整快照回滚；最终 `Tests: 18 passed, 18 total`。

说明：第一次误在没有 `package.json` 的仓库根目录执行，得到 `ERR_PNPM_NO_PKG_MANIFEST`；该环境错误未计作 RED，随后在产品目录取得上述有效 RED。

### Auth rate-limit identity

RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/core/security/rate-limit.guard.spec.ts
```

关键输出：`Test Suites: 1 failed`，`Tests: 2 failed, 1 passed`。随机 key 轮换和 IPv4-mapped 地址两项在第 11 次均错误返回 `true`；非 auth key 的 120 次控制通过。

GREEN：同一命令输出 `Test Suites: 1 passed`、`Tests: 3 passed, 3 total`。

复审 pathname RED：同一命令输出 `Tests: 2 failed, 3 passed`。精确 `/api/auth` 错误 resolve；非 auth pathname 仅因 query 含 `/api/auth/login` 就在第 11 次错误拒绝。GREEN：改为 pathname 精确/前缀匹配后 `Tests: 5 passed, 5 total`。

### Audit durable fallback and retry

RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/core/security/audit.service.spec.ts
```

初次整改关键输出：`Test Suites: 1 failed`，`Tests: 1 failed, 1 passed`；持久化拒绝显示 `Received promise resolved instead of rejected`。初次 GREEN 为 rethrow，`Tests: 2 passed`。

复审 RED：将契约升级为 DB→Redis durable fallback 后，同一命令输出 `Tests: 7 failed, 7 total`：DB-only failure 仍 reject、双失败不是 `AggregateError`、无稳定 ID、无 drain/P2002/HDEL/lifecycle。GREEN：实现后 `Tests: 7 passed, 7 total`。

lint cause TDD：增加 `AggregateError.cause` 断言后有效 RED 为 `Tests: 1 failed, 6 passed`，收到 `undefined`；传入主 DB error 作为 cause 后 GREEN 为 `7 passed`。（此前一次因 ES2021 类型库未声明 `cause` 的编译失败未计作 RED。）

### Redis strict hash primitives

RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/database/redis.service.spec.ts
```

关键输出：`Test Suites: 1 failed`，`Tests: 5 failed, 5 total`；严格 HSET/HSCAN/HDEL API 尚不存在。

GREEN：同一命令输出 `Test Suites: 1 passed`、`Tests: 5 passed, 5 total`；底层异常原样传播，HSCAN 跨空页并遵守 limit，HDEL 返回确认计数。

### Redis AOF durability, fair drain and dead-letter

复审持久性 RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/database/redis.service.spec.ts
pnpm --filter @agentwiki/server exec jest --runInBand src/core/security/audit.service.spec.ts
```

Redis 用例在 `setDurableHashField` / `assertAofDurability` 尚未存在时输出 `5 failed, 5 passed`；最小实现后为 `10 passed`。Audit 的 AOF 未确认与不支持用例 RED 为 `3 failed, 5 passed`，改用 durable hash 边界后 GREEN 为 `8 passed`。

复审公平性 RED：Redis 旧 scanner 重启游标，在新游标契约的非零模拟游标下无限扫描并最终被 Node OOM 中止；Audit 输出 `7 failed, 5 passed`，失败为页对象未支持、坏数据未死信、P2003 未死信及游标未保留。改为每轮只取一个 HSCAN 页、立即保留返回游标，并在持久死信后删 pending，合并 GREEN 为 `2 passed` suites、`23 passed` tests。用例包含 100 个坏项后的后续有效事件、短暂失败下的游标前进、P2003 死信顺序以及死信 fsync 失败时 pending 保留。

启动/健康预检 RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/database/redis.service.spec.ts src/health.controller.spec.ts
```

输出 `2 failed` suites、`4 failed, 11 passed` tests；启动未执行 AOF 预检，健康端点也在 `WAITAOF` 失败时返回成功。实现后 GREEN 为 `2 passed` suites、`15 passed` tests。

### 最终复审：全局 health prefix 与 ACL probe

Compose health URL RED：

```bash
node --test scripts/compose-health-contract.test.mjs
```

静态契约从 Nest 全局 prefix 与 health controller 得到期望路径 `/api/health`，但 Compose 实际 URL 为 `/health`；输出 `1 failed`。Compose 与运维文档同步为 `/api/health` 后输出 `1 passed`。

ACL probe RED：

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/database/redis.service.spec.ts
```

输出 `6 failed, 11 passed`；旧预检只执行 INFO + WAITAOF，HSET/HSCAN/HDEL NOPERM 均错误 resolve，也没有确认删除的 fsync。改为专用随机 probe hash 后 GREEN 为 `17 passed`；成功序列明确为 `INFO, HSET, WAITAOF, HSCAN, HDEL, WAITAOF`，并覆盖 HSET/HSCAN/HDEL 权限失败、删除 fsync 未确认、失败清理重试及成功后无残留 key。

## 最终验证

- 安全闭包与保留行为：

  ```bash
  pnpm --filter @agentwiki/server exec jest --runInBand src/review/review.service.spec.ts src/core/security/rate-limit.guard.spec.ts src/core/security/audit.service.spec.ts src/database/redis.service.spec.ts src/health.controller.spec.ts
  ```

  结果：`5 passed` suites，`54 passed` tests。

- Runtime/Compose 静态契约：

  ```bash
  pnpm test:runtime
  ```

  结果：`8 passed` tests，其中 Compose URL 与 Nest 全局 prefix/controller path 契约通过。

- 服务端类型检查：

  ```bash
  pnpm --filter @agentwiki/server typecheck
  ```

  结果：exit 0，`tsc --noEmit --incremental false`。

- 变更文件 lint：

  ```bash
  pnpm --filter @agentwiki/server exec eslint src/core/filters/business-error.ts src/core/security/audit.service.ts src/core/security/audit.service.spec.ts src/core/security/rate-limit.guard.ts src/core/security/rate-limit.guard.spec.ts src/database/redis.service.ts src/database/redis.service.spec.ts src/health.controller.ts src/health.controller.spec.ts src/review/review.service.ts src/review/review.service.spec.ts
  ```

  结果：exit 0，无 warning/error。

- 全服务 lint：

  ```bash
  pnpm --filter @agentwiki/server lint
  ```

  结果：exit 0，`0 errors, 6 warnings`；6 条均为未触及文件中既有 unused-import warning。

- 完整服务端测试：

  ```bash
  pnpm --filter @agentwiki/server test
  ```

  结果：`20 passed` suites，`105 passed` tests。

- Compose 配置：当前环境没有 Docker CLI，`docker compose config --quiet` 因 `command not found: docker` 无法执行。使用 Ruby Psych 解析 YAML，并断言 Redis service、`--appendonly yes` 与顶层 `redis-data` volume，结果 exit 0：`docker-compose.yml YAML and Redis durability fields valid`。

## 原问题与合法行为结论

- 原页面/关系回滚旁路不再复现：五类资源的条件 mutation 返回 0 时均抛 `CHANGESET_CONFLICT`；Evidence 后续绑定不会被抢占。有状态事务 fake 证明第一项已发生 mutation 后第二项冲突会恢复 page、ChangeItem、ChangeSet 全部初始状态。
- 原 auth key 轮换和 pathname 误判不再复现：同一 IP 使用 11 个不同 key 时第 11 次返回 `AUTH_RATE_LIMITED`；精确 `/api/auth` 受同样保护；query 中出现 auth 字符串不会改变非 auth 的 key bucket；IPv4-mapped 与普通 IPv4 共享同一 auth 桶。
- 原审计缺口不再复现：数据库成功直接落库；DB 失败但 Redis HSET + 本地 AOF fsync 确认成功时调用方正常 resolve；任一 fallback 持久性条件未满足时带两项错误与 DB cause 拒绝，已 HSET 的 pending 仍留作重试。游标跨轮前进，坏数据/永久错误只在死信 AOF 确认后从 pending 删除。
- 合法行为保持：未变更的 create/update/archive page、create/archive relation 均有成功控制；未绑定 Evidence 能恢复；非 auth API key 的第 1–120 次成功，第 121 次被限制；数据库审计成功仍 resolve `undefined` 并保留完整字段，普通 DB audit 故障不再丢失已完成注册/key 轮换的响应。

## 变更文件

- `.superpowers/sdd/remediation-task-1-report.md`
- `agentwiki/apps/server/src/core/filters/business-error.ts`
- `agentwiki/apps/server/src/core/security/audit.service.ts`
- `agentwiki/apps/server/src/core/security/audit.service.spec.ts`
- `agentwiki/apps/server/src/core/security/rate-limit.guard.ts`
- `agentwiki/apps/server/src/core/security/rate-limit.guard.spec.ts`
- `agentwiki/apps/server/src/database/redis.service.ts`
- `agentwiki/apps/server/src/database/redis.service.spec.ts`
- `agentwiki/apps/server/src/health.controller.ts`
- `agentwiki/apps/server/src/health.controller.spec.ts`
- `agentwiki/apps/server/src/review/review.service.ts`
- `agentwiki/apps/server/src/review/review.service.spec.ts`
- `agentwiki/docker-compose.yml`
- `agentwiki/docs/operations/redis-audit-durability.md`
- `agentwiki/scripts/compose-health-contract.test.mjs`

## 剩余顾虑

- 没有启动真实 PostgreSQL/Redis；Review 使用可回滚有状态 transaction fake，Redis `WAITAOF` / lifecycle 使用 ioredis client double。Compose 已启用 AOF 和持久卷，应用也会 fail-closed 预检，但外部生产 Redis 的 AOF、存储卷、ACL 与 HA 仍需运维按文档保证。当前环境缺少 Docker CLI，未能执行真实 `docker compose config` 或容器联调。
- 全服务 lint 的 6 条 warning 位于本 Task 未触及文件；本 Task 变更文件 lint 为零 warning。
