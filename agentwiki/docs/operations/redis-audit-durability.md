# Redis 审计日志持久性

AgentWiki 在主数据库不可用时，会把审计事件写入 Redis `audit:pending` 哈希。这条备用路径是安全边界：只有 Redis 确认本地 AOF 已 fsync 后，写入才算成功。

## 生产要求

- Redis 必须为 7.2 或更高版本；[`WAITAOF`](https://redis.io/docs/latest/commands/waitaof/) 自 7.2 起可用。项目 Compose 默认使用 `redis:7.4-alpine`。
- Redis 必须启用 AOF，并把 `/data` 放在持久卷上。项目 Compose 显式启动 `--appendonly yes --appendfsync everysec`。Redis 官方的 [persistence 文档](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) 说明了 AOF 与 fsync 策略。
- 外部托管 Redis 必须在服务端配置 AOF；应用不会执行 `CONFIG SET`。运行账号至少需要 `INFO` 、`WAITAOF` 、`HSET` 、`HSCAN` 和 `HDEL` 权限。
- 启动和 `GET /api/health` 都会先检查 `INFO persistence` 中的 `aof_enabled:1`，然后在专用的 `audit:durability-probe:<UUID>` 哈希上顺序执行 `HSET`、`WAITAOF 1 0 1000`、`HSCAN` 回读、`HDEL` 和再一次 `WAITAOF`。两次命令返回的本地 fsync 数都必须至少为 1。任一 ACL、回读或 fsync 检查失败都会导致启动失败或健康检查返回 503。预检使用随机专用 key，不写入 `audit:pending` / `audit:dead`，并在成功或失败时尝试持久清理。

## 写入与重试语义

1. 审计写入先尝试 PostgreSQL，事件在两条路径上共用同一个 UUID。
2. PostgreSQL 失败时，应用执行 `HSET audit:pending ...`，紧接着在同一 Redis 连接上执行 `WAITAOF 1 0 1000`。
3. 如果 `HSET` 成功但 `WAITAOF` 超时、不受支持或返回的本地 fsync 数不足，`audit:pending` 字段仍保留供后续重试，但当前记录请求会拒绝，因为持久性尚未得到确认。
4. 后台每轮保留 `HSCAN` 游标，Redis 返回多于 `COUNT` 提示的项时也会全部处理。短暂的 Prisma 错误会保留原项，但不阻断游标进入后续页。
5. 无法解析的数据和确定为永久的 Prisma 输入/约束错误会转移至 `audit:dead`。应用先对死信执行并确认 `WAITAOF`，然后才从 `audit:pending` 删除；死信 fsync 失败时原项保留。

## 部署与排查

Compose 部署可先检查 Redis 配置：

```sh
docker compose exec redis redis-cli INFO persistence
```

输出必须包含 `aof_enabled:1`。然后检查应用端的完整持久性预检：

```sh
curl --fail http://127.0.0.1:3000/api/health
```

如果启动失败或健康检查返回 503，查看服务日志中的 `Redis durability preflight` 或 `Redis durability probe cleanup` 错误。常见原因是 Redis 版本低于 7.2、AOF 未启用、ACL 禁止 `INFO`/`WAITAOF`/`HSET`/`HSCAN`/`HDEL`，或 fsync 在 1 秒内未能确认。修复 Redis 服务端后重启应用，并检查 `audit:pending` 和 `audit:dead` 的积压。
