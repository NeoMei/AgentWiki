# v0.12.63 发布回执工具

本目录工具尚不构成部署成功回执。冻结提交、备份路径、主机/公网验收结果由实际执行后生成的 JSON 记录。

## 冻结源码

在 canonical 检出运行 release guard，将 0.12.63 版本与本目录工具提交后，使用完整提交 SHA。准备工具只读取该提交的 Git archive 字节，禁止混入工作树变更、配置或凭据。输出目录必须是新的。

```sh
python3 agentwiki/docs/verification/bug-release-v01263-20261027/prepare-source-manifest.py \
  --repo . --revision <full-frozen-sha> --out-dir /tmp/agentwiki-v01263-receipts-<sha>
```

`ENTRY` 固定为本目录的 `verify-release.py`；共享只读核验实现取自同一冻结提交中的 `notification-unread-20261023/verify-release.py`，并嵌入输出 standalone verifier。

确认输出的源码 manifest/verifier SHA-256 后，再复制至服务器私有发布工具目录。部署须从冻结提交新建的干净 detached 检出运行，不能从包含 `design/` 或其他工作树变更的目录打包。

## 配对备份与隔离恢复

在部署前通过已认证 SSH 执行 `backup-production-v01263.sh`。它持有部署锁，临时暂停 API/worker，将数据库和附件作为一致快照捕获，归档应用和配置，校验哈希并恢复原服务。备份只保存在服务器 `/var/backups/agentwiki/bug-release-v01263.*`，不得复制敏感归档到公开仓库。

```sh
bash backup-production-v01263.sh
python3 verify-backup-restore.py --backup /var/backups/agentwiki/bug-release-v01263.<suffix> --check
python3 verify-backup-restore.py --backup /var/backups/agentwiki/bug-release-v01263.<suffix>
```

隔离恢复器须以 root 运行。`--check` 仅检查备份私有路径、完成状态、dump SHA 和本机 PostgreSQL 管理连接；不创建数据库。实际恢复只用 `/var/run/postgresql:5432` 的 postgres OS 账号，在一个此前不存在的随机 `agentwiki_restore_v01263_*` 数据库执行 `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`。恢复成功后检查应用表和完成的迁移记录；失败或中断仍清理本次创建的数据库。`dropdb --force` 仅用于该随机临时库，绝不针对业务库。

数据库名称由脚本生成，不接受外部目标库参数。源业务数据库、配置和附件没有写入。原始恢复日志留在备份目录的 0600 文件中，公开 JSON 只含状态、散列和表/迁移计数。恢复到临时库仅证明 dump 可恢复；生产回滚仍必须配对应用、数据库、配置、附件，并考虑备份后新增写入。

本地控制流验证命令（mock PostgreSQL，无数据库或生产访问）：

```sh
python3 docs/verification/bug-release-v01263-20261027/verify-backup-restore.spec.py
```

## 主机与公网核验

从准备回执取完整 SHA、manifest SHA 和文件数。复制的工具/manifest 必须先与本地 SHA 匹配。

```sh
python3 verify-release.py --mode host --revision <full-frozen-sha> \
  --manifest-sha256 <manifest-sha256> --expected-files <count> --manifest source-manifest.json
python3 verify-release.py --mode public --revision <full-frozen-sha> \
  --manifest-sha256 <manifest-sha256> --expected-files <count> --host-receipt production-host.json
```

host 模式在服务器执行；public 模式从另一台机器核验 HTTPS。二者只读，核验冻结源文件、版本、三项服务、五项 health，以及公网 HTML/入口资产与主机产物一致。版本应为 Web/Client/API 0.12.63、Local Sync 0.13.5、protocol 0.6.1。真实浏览器业务验收与 GitHub 正式 Release 另记，不将健康检查等同于原始问题验收。
