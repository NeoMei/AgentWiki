# Connection UX 独立真实连接授权 DB 门禁

结论：PASS。独立 PostgreSQL + Redis，指定 spec 3/3 通过，1 suite 通过，Jest 5.31 秒。产品代码未修改，未 build、未启动 API/worker/模型。Windows-specific Opencode skip 未在 macOS 执行。

## 有效执行

- spec：`agentwiki/apps/server/src/onboard/onboard-connection.db.spec.ts`
- 命令：server 目录执行 `./node_modules/.bin/jest --runInBand --no-cache --runTestsByPath src/onboard/onboard-connection.db.spec.ts`
- `CONNECTION_UX_DB_TEST=1`，独占库 `connection_ux_server_test_aa09b914e9332b3d323a19b3`，独占 loopback Redis 端口 55928 / DB 1，AOF yes / everysec。
- 执行前写入 0600 ownership record，使用独立 HOME/TMPDIR，白名单重建环境，生成自己的 deployment seed / pepper / JWT secret。仅沿用本地 PostgreSQL 管理连接的 loopback host/user 以创建独占库，不连接 root 验收业务库、不共享 root Redis。
- 必需配置：PUBLIC_API_URL=http://127.0.0.1:9/api（仅响应 metadata，无 API 服务）；LOCAL_SYNC_PACKAGE_VERSION=0.11.0。该版本与当前 package 和支持常量一致。
- 仅在自己新建数据库创建 vector、通过 Prisma migrate deploy 应用仓库既有迁移。

覆盖：真实模块图编译及并发轮询 exactly-one installation / exchange / activation；approve-deny CAS 与 purpose 隔离；同 Agent session owner 续期、bootstrap Space、过期 receipt 恢复和无重复资源。

## 原始失败与环境修正

前三轮原始 Jest 日志均保留，未修改 spec 或放宽校验：R1 缺 Redis AOF，3 fail；R2 缺 PUBLIC_API_URL，2 pass / 1 fail；R3 缺配置的 LOCAL_SYNC_PACKAGE_VERSION，2 pass / 1 fail。R3 中测试发送的 0.9.1 在产品支持列表内，失败来自服务器配置缺失。每轮均新建独立随机资源；R1/R2 清理保护因 Redis process title / macOS canonical path 差异停止后，按记录重新核验所有权并补清理，原始清理 receipt 保留。最终有效执行 3 pass / 0 fail。

## 清理证据

最终 runner 核验自身 Redis PID 启动时间和 CONFIG dir 后终止；数据库 shared comment owner marker 匹配后 DROP；确认库不存在、Redis 端口可绑定、独立 TMP 已删除。随后另一个独立命令对四轮全部 ownership records 再查 PostgreSQL、ps、端口和文件系统：全部数据库不存在、记录 PID 不存在、端口可绑定、临时目录不存在，ownership records 均 0600。未保留运行服务。

证据目录同本报告：
- connection-ux-jest.log：最终 3/3 PASS。
- connection-ux-migrations.log：独占库迁移。
- connection-ux-owned.json、connection-ux-cleanup-receipt.json：最终 ownership 与清理。
- connection-ux-external-cleanup-verification.json：四轮外部复核全部通过。
- connection-ux-{owned,jest,migrations,redis,cleanup-receipt}-r1/r2/r3 对应后缀文件：历史环境失败原始证据。
- run-connection-ux-owned.py：隔离执行脚本，环境修正仅在 /tmp。
