# v0.12.65 发布回执工具

本目录复用 v0.12.64 的配对备份、隔离恢复和只读核验实现，保留原安全边界。版本、工具入口和备份/临时数据库前缀调整为本轮 .65。工具和说明不构成部署成功回执。

## 冻结源码

先将实现、Web/Client/API 0.12.65、release lock 与本目录工具提交，并通过 release guard 和实际门禁。以下命令从 Git 仓库根目录运行，参数使用完整冻结 SHA。输出目录必须尚不存在。

```sh
python3 agentwiki/docs/verification/space-review-release-v01265-20261028/prepare-source-manifest.py \
  --repo . --revision <full-frozen-sha> --out-dir /tmp/agentwiki-v01265-receipts-<sha>
```

所有 manifest 输入和核验器字节均取自指定提交的 Git archive，排除配置/凭据和构建产物。`ENTRY` 固定为本目录 `verify-release.py`；共享只读实现取自同一冻结提交 `notification-unread-20261023/verify-release.py` 并嵌入 standalone verifier。准备回执提供 revision、sourceFiles、manifestSha256、verifierSha256 和 verifierArgs。

确认源码 manifest/verifier 哈希后，将工具复制到服务器新的私有发布工具目录并核对传输哈希。部署必须从冻结提交新建的干净 detached 检出执行；不得直接打包包含 design/ 或其他工作树变更的 canonical 目录。

## 配对备份与隔离恢复

在部署前，通过已认证 SSH 以 root 执行以下工具。备份持有部署锁，暂停 API/Worker 捕获一致的数据库/附件快照，同时归档应用和配置并验证哈希，随后恢复原服务。敏感归档仅保存在服务器私有目录，不得复制到公开仓库。

```sh
bash backup-production-v01265.sh
python3 verify-backup-restore.py --backup /var/backups/agentwiki/space-review-release-v01265.<suffix> --check
python3 verify-backup-restore.py --backup /var/backups/agentwiki/space-review-release-v01265.<suffix>
```

备份前缀为 `space-review-release-v01265.*`，恢复器仅接受此前缀的 root 私有备份。`--check` 只验证路径、完成状态、dump SHA 和本机 PostgreSQL 管理连接，不创建数据库。实际恢复通过本机 `/var/run/postgresql:5432`、postgres OS 账号恢复到此前不存在的随机 `agentwiki_restore_v01265_*` 数据库；使用 single-transaction/exit-on-error/no-owner/no-privileges，完成或失败后仅清理本次创建的临时库。恢复原始日志保留在备份内的 0600 文件；公开 JSON 仅含状态、哈希和表/迁移计数。

源业务库、配置和附件不被恢复器写入。临时恢复只证明 dump 可恢复；正式回滚必须配对应用、数据库、配置和附件，并考虑备份后新增写入。

本地控制流验证（mock PostgreSQL，无生产访问）：

```sh
PYTHONPYCACHEPREFIX=/tmp/agentwiki-v01265-pycache \
  python3 agentwiki/docs/verification/space-review-release-v01265-20261028/verify-backup-restore.spec.py
```

## 部署

从冻结提交新建的干净 detached 检出内进入 agentwiki/：

```sh
bash deploy.sh 113.249.120.24 root
```

若已有任务专属 SSH 控制连接，可设置绝对路径 `AGENTWIKI_SSH_CONTROL_PATH`；脚本要求其为活跃 Unix socket。使用已有认证连接，不打印或写入凭据。

## 主机与公网核验

从准备回执取完整 SHA、manifest SHA 和文件数。以下命令在工具目录执行；host 模式在服务器执行，public 模式从另一台机器核验 HTTPS。

```sh
python3 verify-release.py --mode host --revision <full-frozen-sha> \
  --manifest-sha256 <manifest-sha256> --expected-files <count> --manifest source-manifest.json
python3 verify-release.py --mode public --revision <full-frozen-sha> \
  --manifest-sha256 <manifest-sha256> --expected-files <count> --host-receipt production-host.json
```

核验版本为 Web/Client/API 0.12.65、Local Sync 0.13.5、protocol 0.6.1；核验冻结源文件、三服务、五 health、公网 HTML/入口资产与主机产物的一致性。changed-flow 浏览器业务验收和 GitHub 正式 Release 单独留证，不将健康检查等同于原始功能验收。

## 本轮业务验收边界

本轮 changed-flow 验收须另行留证：复制协作指令后真实 Clipboard 内容与成功/失败反馈；新建空间默认无需审核、创建时可选审核；现有空间策略保持原值；owner 在标题入口和设置页切换策略、失败重试及基本资料草稿保留；非 owner 只读；390px 与键盘焦点。真实 MCP/数据库发布策略与隔离浏览器 fixture 是不同证据，不能互相替代。

生产浏览器脚本必须经独立审阅，使用全新隔离 context 和本轮专属账号/资源 allowlist，不访问用户已有 profile，不请求模型；所有写请求只发送一次，在 finally 删除本轮临时资源并读回确认。公开回执不含邮箱、密码、token 或私有恢复日志。当前工具准备与本地 mock 不构成生产业务验收。

旧发布目录的 `browser-request-policy.mjs` 与 `browser-request-policy.spec.mjs` 保持原字节；其 GET/HEAD 限流恢复与单次写入约束由新业务验收脚本复用。已审阅且未变化的 7 项 fake-fetch/fake-clock 限流测试可引用既有回执；不在本轮工具回执中冒称重跑。

## 本地工具验证

`tools-validation.json` 仅记录本目录 Python 编译、Bash syntax、CLI help、6 项 mock PostgreSQL 恢复/清理控制流、版本/路径配对和冻结输入 hash matching fixture；未连接生产、未执行备份或部署、未准备最终冻结源码 manifest。最终 manifest 必须在新入口与 .65 版本已提交后，针对该完整冻结提交重新生成。
