# 全量门禁环境与修正记录

所有服务和账号均是本机合成测试环境，未接入生产或真实模型提供方。

- Node 24.18.0、pnpm 11.9.0，PostgreSQL 16 / vector。
- 网页产品验收使用本地 UI 专用数据库；全量门禁另用 `agentwiki_test_20261008_gate` 与 Redis 6392，避免测试清理影响浏览器数据。
- `AGENTWIKI_FULL_TEST=1`，数据库用例要求零跳过。全部八个数据库环境变量均显式配置；版本一致性用例独用已迁移的 `agentwiki_sync_version_test_20261008`。
- `PG_DUMP_BIN=/opt/homebrew/bin/pg_dump`。第一次数据库门禁失败由控制器漏配该路径及版本库命名 guard 引起，未据此改产品实现。
- 再次运行的 230 个数据库测试中，228 通过、两条父级最终清理断言失败；两组内部业务子用例全部通过。`countSanitizedMigrationDirectories()` 遍历整个 `os.tmpdir()`，计入了两个本轮运行前已存在的目录（修改时间分别为 2026-10-06 06:18 UTC、21:30 UTC）。没有删除这些旧目录；最终运行把 TMPDIR 隔离至新建的 `/tmp/agentwiki-1008-gate-isolated-tmp`。
- 此前版本契约仍硬编码 0.12.12，与基线实际 0.12.16 不符；提交 `167237a1` 改为验证根应用版本有效且三个应用一致，Local Sync 0.11.0 与协议 0.6.1 独立版本约束未改。
- 产品依赖、版本和迁移未因本次门禁环境问题变更。失败日志保留于本机 `/tmp/agentwiki-1008-{runtime-version-baseline,db-env,temp-dir-env}-failure.log`；最终结果以 [status.md](status.md) 和门禁汇总为准。

## 证据范围

真实 API/Chrome 验证与 API 响应 fixture 已在逐项矩阵区分。原生 Obsidian 使用新建隔离 Vault、macOS、Sync V2 和插件 `e5b8a3a`。最终插件 `d1d89de` 只追加双语提示及其回归测试，完整 npm run check 在该最终 SHA 上重跑，不能把这一事实外推为该 SHA 的再次原生安装验证。

插件原生验收结束时已撤销合成设备并清空插件本地凭据，保留同步文件与映射；原用户 Vault 和 Obsidian 主进程保留。第二测试实例引起的 CLI socket 问题已恢复，详细经过见原生验收回执。

## 本地服务收尾

最终源码d6c3934a的完整构建与复审通过后，控制器先核对PID、工作目录和Redis数据目录，再仅停止本轮自建API3191、Vite5191/5192、Redis6391/6392；五个端口均已无监听。预算补修preview5197已由实施者关闭。既有PostgreSQL服务、日常Obsidian进程及Vault未停止。隔离测试数据库、测试目录、真实同步文件和证据保留，可按环境记录复现。
