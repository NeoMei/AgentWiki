# v0.12.64 发布回执工具

本目录复用 v0.12.63 的配对备份、隔离恢复和只读核验实现，保留原安全边界。版本、工具入口和备份/临时数据库前缀调整为本轮 .64。工具和说明不构成部署成功回执。

## 冻结源码

先将实现、Web/Client/API 0.12.64、release lock 与本目录工具提交，并通过 release guard 和实际门禁。以下命令从 Git 仓库根目录运行，参数使用完整冻结 SHA。输出目录必须尚不存在。

```sh
python3 agentwiki/docs/verification/notes-release-v01264-20261028/prepare-source-manifest.py \
  --repo . --revision <full-frozen-sha> --out-dir /tmp/agentwiki-v01264-receipts-<sha>
```

所有 manifest 输入和核验器字节均取自指定提交的 Git archive，排除配置/凭据和构建产物。`ENTRY` 固定为本目录 `verify-release.py`；共享只读实现取自同一冻结提交 `notification-unread-20261023/verify-release.py` 并嵌入 standalone verifier。准备回执提供 revision、sourceFiles、manifestSha256、verifierSha256 和 verifierArgs。

确认源码 manifest/verifier 哈希后，将工具复制到服务器新的私有发布工具目录并核对传输哈希。部署必须从冻结提交新建的干净 detached 检出执行；不得直接打包包含 design/ 或其他工作树变更的 canonical 目录。

## 配对备份与隔离恢复

在部署前，通过已认证 SSH 以 root 执行以下工具。备份持有部署锁，暂停 API/Worker 捕获一致的数据库/附件快照，同时归档应用和配置并验证哈希，随后恢复原服务。敏感归档仅保存在服务器私有目录，不得复制到公开仓库。

```sh
bash backup-production-v01264.sh
python3 verify-backup-restore.py --backup /var/backups/agentwiki/notes-release-v01264.<suffix> --check
python3 verify-backup-restore.py --backup /var/backups/agentwiki/notes-release-v01264.<suffix>
```

备份前缀为 `notes-release-v01264.*`，恢复器仅接受此前缀的 root 私有备份。`--check` 只验证路径、完成状态、dump SHA 和本机 PostgreSQL 管理连接，不创建数据库。实际恢复通过本机 `/var/run/postgresql:5432`、postgres OS 账号恢复到此前不存在的随机 `agentwiki_restore_v01264_*` 数据库；使用 single-transaction/exit-on-error/no-owner/no-privileges，完成或失败后仅清理本次创建的临时库。恢复原始日志保留在备份内的 0600 文件；公开 JSON 仅含状态、哈希和表/迁移计数。

源业务库、配置和附件不被恢复器写入。临时恢复只证明 dump 可恢复；正式回滚必须配对应用、数据库、配置和附件，并考虑备份后新增写入。

本地控制流验证（mock PostgreSQL，无生产访问）：

```sh
PYTHONPYCACHEPREFIX=/tmp/agentwiki-v01264-pycache \
  python3 agentwiki/docs/verification/notes-release-v01264-20261028/verify-backup-restore.spec.py
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

核验版本为 Web/Client/API 0.12.64、Local Sync 0.13.5、protocol 0.6.1；核验冻结源文件、三服务、五 health、公网 HTML/入口资产与主机产物的一致性。changed-flow 浏览器业务验收和 GitHub 正式 Release 单独留证，不将健康检查等同于原始功能验收。

## 隔离 Chrome 业务验收

`production-browser-acceptance.mjs` 只有在明确环境确认后才创建临时资源。使用系统 Chrome 的全新 headless context，通过正常 UI 登录本轮临时账号；不打开或修改用户已有 profile。所有写请求受本轮创建的账号/资源 ID allowlist 约束，无模型请求。finally 依次删除临时笔记、页面、空间和账号，使用最新 OCC/Tree revision 并读回确认。使用 API 的删除语义；保留系统正常审计/软删除记录。回执不保存邮箱、密码或 token。

生产环境须先人工审阅脚本与部署版本，然后从 agentwiki/ 目录执行：

```sh
RELEASE_APPROVED=0.12.64 CONFIRM_REMOTE_E2E_HOST=agentwiki.quukk.com \
  QA_OUTPUT=/tmp/agentwiki-v01264-browser \
  node docs/verification/notes-release-v01264-20261028/production-browser-acceptance.mjs
```

同一脚本可用于本地隔离实例（实例必须支持正常注册、登录、空间/页面/笔记 API）：

```sh
RELEASE_APPROVED=0.12.64 QA_ORIGIN=http://127.0.0.1:5173 \
  CONFIRM_LOCAL_E2E_HOST=127.0.0.1:5173 QA_OUTPUT=/tmp/agentwiki-v01264-local-browser \
  node docs/verification/notes-release-v01264-20261028/production-browser-acceptance.mjs
```

本脚本覆盖双视图、跨空间/作者/@我/状态筛选、正文/引用/标题检索、20+ 分页、来源深链、失效选区降级、重复高亮打开、读/编辑/读返回筛选与分页位置、390px 布局、蓝色 Logo 资源 hash/像素，以及只撤销本轮 viewer 成员关系后的 accessRevision/分页/UI 失权。SIGINT/SIGTERM 会中止浏览器并进入 finally；强制杀进程或主机断开仍可能留下临时资源，应按失败回执中的本轮 ID 处理。公开回执须如实保留失败和清理状态，不将该脚本当作原用户业务环境回归证明。

### 只读限流恢复

显式 API 请求间隔至少 200ms。仅 GET/HEAD 响应 429 时自动重读，最多两次；按 Retry-After（秒或 HTTP 日期）等待，最多 61 秒，无有效 header 则等待下一分钟 bucket 后 1 秒。每次等待最多 60 秒，61 秒分两段；每次 fetch 的 25 秒超时独立于重读等待。所有写请求（包括 DELETE）只发送一次；网络中断或非 429 响应不自动重试。重读次数和等待时长以无凭据字段记录在 rateLimitReadRetries。

```sh
node --test docs/verification/notes-release-v01264-20261028/browser-request-policy.spec.mjs
```

该测试使用 fake fetch/fake clock，不访问本地或生产业务服务，不实际等待。历史失败验收回执须单独保留，不因后续脚本调整覆盖。
