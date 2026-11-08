# v0.12.66 发布回执工具

本目录沿用 v0.12.65 已审阅的配对备份、隔离恢复和只读核验实现，仅调整版本、工具入口、备份前缀与恢复数据库命名空间。脚本存在、语法检查或 mock 测试通过均不代表生产发布成功。

## 冻结与本地门禁

将所有者可见性修复、Web/Client/API 0.12.66、release lock 和本目录工具提交，保留 Local Sync 0.13.5、protocol 0.6.1。完成 release guard、全量测试、类型检查、lint、全包构建及独立复核；初始 JS 继续遵守 551000 字节门禁。

从冻结提交建立干净 detached 检出；创建 worktree 前读取 Codex Desktop 当前 git-worktree-root 并确认外置卷已挂载可写。禁止从含 design/ 或其他未提交变更的 canonical 工作区直接打包。

以下命令从 Git 仓库根目录运行，使用完整冻结 SHA，输出目录须不存在：

```sh
python3 agentwiki/docs/verification/agent-owner-release-v01266-20261109/prepare-source-manifest.py \
  --repo . --revision <full-frozen-sha> --out-dir /tmp/agentwiki-v01266-receipts-<sha>
```

manifest 及 standalone verifier 全部输入取自指定提交的 Git archive，排除 .env、node_modules、dist、coverage 和 tar.gz。将工具和 manifest 复制到服务器新建的私有目录，核对传输 SHA256；仅使用新回执提供的完整 revision、manifestSha256、sourceFiles 和 verifierSha256。

## 配对备份与隔离恢复

生产目标为 `root@113.249.120.24`。使用已授权认证方式和任务专属 SSH 控制连接；不得把密码、私钥、令牌或带凭据的 URL 写入仓库/公开回执。备份须先于部署执行，deploy.sh 不会代建备份。

```sh
bash backup-production-v01266.sh
python3 verify-backup-restore.py --backup /var/backups/agentwiki/agent-owner-release-v01266.<suffix> --check
python3 verify-backup-restore.py --backup /var/backups/agentwiki/agent-owner-release-v01266.<suffix>
```

备份持有部署锁，暂停 API/Worker 捕获一致的 DB/附件快照，归档应用/配置并核对哈希后恢复服务。敏感归档仅保留服务器 root 私有目录。恢复器只接受本轮 `agent-owner-release-v01266.*` 前缀的已验证私有备份；`--check` 不创建数据库。实际恢复通过本机 PostgreSQL 管理连接创建此前不存在的随机 `agentwiki_restore_v01266_*` 库，使用 single-transaction/exit-on-error/no-owner/no-privileges；成功、失败或中断后只清理本次创建的库。原始恢复日志保留备份目录内的 0600 文件，公开回执不含连接材料。

隔离恢复只证明 dump 可恢复。回滚必须配对应用、数据库、配置和附件，并先评估备份后新增写入；不可盲目恢复历史 DB。

## 部署及只读核验

仅从冻结 clean detached 检出的 agentwiki/ 执行，明确指定生产目标；deploy.sh 默认主机不是生产：

```sh
bash deploy.sh 113.249.120.24 root
```

可设置 `AGENTWIKI_SSH_CONTROL_PATH` 为任务专属活跃 Unix socket 的绝对路径。脚本先在 staged 目录构建并校验外部 OpenCode 边界，再停服务、Prisma migrate deploy、切换应用目录；旧应用保留为 `/root/agentwiki-previous-*`。

使用新 preparation receipt 的参数，在服务器执行 host 模式并保存其 JSON；在另一台机器从 HTTPS 执行 public 模式：

```sh
python3 verify-release.py --mode host --revision <full-frozen-sha> \
  --manifest-sha256 <manifest-sha256> --expected-files <count> --manifest source-manifest.json
python3 verify-release.py --mode public --revision <full-frozen-sha> \
  --manifest-sha256 <manifest-sha256> --expected-files <count> --host-receipt production-host.json
```

核验精确源码、Web/Client/API 0.12.66、Local Sync 0.13.5、protocol 0.6.1；API/Worker/frontend 三服务 active；health 的 status/database/redis/auditPersistence/attachmentStorage 五项均 ok；公网 HTML 和入口资源与服务器构建产物哈希一致。GitHub 正式 Release/tag 指向冻结源的读回另行留证。

## 本轮业务验收

真实生产 UI/API 应验证同名不同所有者的 Agent 可以由姓名和账号区分；覆盖列表、详情、空间成员、页面/目录绑定、协作角色分配与任务改派。保留 Agent ID 提交值、禁用原因和原管理权限，检查中英文、缺失姓名/所有者数据及 390px 长账号换行。

如使用隔离测试账号/空间/Agent，必须限制写入本轮拥有的资源，写请求只发送一次，最后清理并读回。无需发起模型或 Agent 执行，不改原业务账号、配置或 rollout。健康检查、单元测试或 fixture 页面均不能替代已声明的真实生产功能验收。

## 本地工具检查

```sh
bash -n agentwiki/docs/verification/agent-owner-release-v01266-20261109/backup-production-v01266.sh
PYTHONPYCACHEPREFIX=/tmp/agentwiki-v01266-pycache \
  python3 agentwiki/docs/verification/agent-owner-release-v01266-20261109/verify-backup-restore.spec.py
```

Python 编译、CLI help 与上述 mock 测试均不连接生产；最终 manifest 必须在新版本与工具已提交后从精确冻结 SHA 重新生成。本目录不复制旧成功回执。
