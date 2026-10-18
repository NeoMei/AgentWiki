# 0.12.48 / 0.13.2 发布执行计划（npm与生产发布验证完成，真实新WorkBuddy验收进行中）

2026-10-19 用户已明确批准冻结候选 `0a299231667f03e68f6b97a0501c632602a75ae5` 发布 npm Local Sync 0.13.2、部署 Web/API 0.12.48，并继续真实 WorkBuddy 验收。该授权持续有效，不需要重复发布审批。npm0.13.2官方回读和空缓存安装、Web/API0.12.48固定候选部署、1357源码与公网HTML/5入口资源均已验证通过；正在继续真实新WorkBuddy接入验收，尚未完成宿主端到端结论。数据库配对恢复仍须按本文 F 节单独确认新写入的数据窗口，不能作为自动失败处理。

## 固定候选和目标

- 源码：`0a299231667f03e68f6b97a0501c632602a75ae5`，Web/API/client/root `0.12.48`，Local Sync `0.13.2`，protocol `0.6.1`。
- npm 包：`/tmp/agentwiki-0132-release-candidate/neomei-agentwiki-local-sync-0.13.2.tgz`。
- 包 SHA-256：`836a92c65c9fae6ba3fbc181a6b861cbd4380517764291115b6ce45bc86556b9`；175 文件；199526 bytes；shasum `37b272c769328a87ce53e8152fc6e6e2f433fc66`。
- 最近已提交 0.12.47 回执及其 `/tmp/agentwiki-release-20261017/deploy.log` 指向 `root@113.249.120.24`，应用 `/root/agentwiki`。这不是本轮在线核实；先执行下述只读前检，若目标/版本不同则停止重新绑定。
- 单元：root 的 `systemctl --user` 管理 `agentwiki-api.service`、`agentwiki-worker.service`、`agentwiki-frontend.service`；分别使用 3000/5173 端口，worker 无对外端口。
- 附件：`/var/lib/agentwiki/attachments`，独立于应用树；部署锁：`/root/.agentwiki-deploy.lock`。
- 公网：`https://agentwiki.quukk.com`。`deploy.sh` 的默认 `100.64.35.78/neomei` 不是最近生产目标，必须显式传入上述已复核 host/user。
- 规程：`deploy.sh`、`deploy/systemd/*.service`、`docs/operations/markdown-attachments.md`、`docs/verification/retest-20261017/release.json`。

本地准备目录 `/tmp/agentwiki-release-20261019-plan` 已有：

- `backup-production.py`：复制上一轮备份程序，只更新备份前缀、期望旧版本和旧发布 SHA，语法检查通过；原 `/tmp/agentwiki-release-20261017` 未修改。
- `backup-metadata.diff`：以上三个元数据替换的精确差异。
- `source-manifest.json`：从固定 Git commit 导出的 1357 个部署源码文件，包含路径、长度和 SHA-256。

备份脚本 SHA-256 为 `98c9845e254cc3917320a8e2b13a2dbe7ee09283cbae3151d14031f6417f0588`。正式执行前再次查看脚本和差异。脚本取得部署锁，要求旧版本 `0.12.47`，先保存应用与配置，再停止 API/worker 并确认 inactive/MainPID=0，取得数据库 custom dump 和完整附件归档，验证后恢复 writer。恢复演练不在已通过证据中。

## A. 本地冻结与发布前门禁

以下变量只在当前 shell 定义，不能覆盖 HOME/CODEX_HOME：

```bash
release_repo='/Users/neomei/.codex/worktrees/generic-mcp-onboarding/AgentWiki '
release_sha='0a299231667f03e68f6b97a0501c632602a75ae5'
release_plan='/tmp/agentwiki-release-20261019-plan'
release_tgz='/tmp/agentwiki-0132-release-candidate/neomei-agentwiki-local-sync-0.13.2.tgz'
cd "$release_repo"
test "$(git --work-tree="$PWD" rev-parse "$release_sha^{commit}")" = "$release_sha"
shasum -a 256 "$release_tgz"
node agentwiki/scripts/sync-v3-registry-collision-gate.mjs --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

核对摘要为本计划固定值。后续纯回执文档提交可以让HEAD前进；部署始终从固定release_sha导出，不能改用HEAD或当前工作目录代替。保持旧会话和当前用户连接不变；0.13.2 不恢复 0.13.1 本地检查点。碰撞检查若发现版本已存在，必须下载比对并判断是否已经完成本候选发布，不盲目改版本或覆盖。

候选已通过的本地门禁见 `release-candidate.json`。若候选源码/打包内容发生变化，先重新审查和验包，不能沿用此摘要。

## B. 生产只读前检（本轮已通过，部署前按需复核）

```bash
ssh root@113.249.120.24 'bash -se' <<'REMOTE'
set -euo pipefail
cd /root/agentwiki
/usr/bin/node -e 'for(const p of ["./package.json","./apps/server/package.json","./apps/client/package.json","./packages/local-sync/package.json","./packages/sync-protocol/package.json"])console.log(p,require(p).version)'
/usr/bin/node --version
systemctl --user is-active agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service
systemctl --user show -p User -p WorkingDirectory -p ExecStart agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service
curl -fsS http://127.0.0.1:3000/api/health
stat -c '%n %U:%G %a' /var/lib/agentwiki/attachments
readlink -f /var/lib/agentwiki/attachments
df -Pk /root /var/backups/agentwiki /var/lib/agentwiki/attachments
REMOTE
```

只输出白名单版本、服务和存储信息，不 cat `.env` 或打印环境。要求 Web/API/client 为 0.12.47、Local Sync 0.13.1、protocol 0.6.1，Node 24/26，三个服务 active，健康项均 ok，附件路径正规且 0700。实际生产有其他改动时停止，先核对前一次发布清单；不能直接以版本号相同替代源码核实。

## C. npm 发布与官方回读（登录已通过，独立发布安全密钥验证待重试）

```bash
npm publish "$release_tgz" --access public --tag latest --registry=https://registry.npmjs.org/
npm view @neomei/agentwiki-local-sync@0.13.2 version dist dist-tags --json --registry=https://registry.npmjs.org/ > "$release_plan/registry-0132.json"
mkdir "$release_plan/registry-download"
npm pack @neomei/agentwiki-local-sync@0.13.2 --ignore-scripts --json --registry=https://registry.npmjs.org/ --pack-destination "$release_plan/registry-download" > "$release_plan/registry-pack.json"
cmp "$release_tgz" "$release_plan/registry-download/neomei-agentwiki-local-sync-0.13.2.tgz"
mkdir "$release_plan/registry-install" "$release_plan/registry-cache"
npm install --prefix "$release_plan/registry-install" --cache "$release_plan/registry-cache" --registry=https://registry.npmjs.org/ --prefer-online --ignore-scripts --no-audit --no-fund @neomei/agentwiki-local-sync@0.13.2
node "$release_plan/registry-install/node_modules/@neomei/agentwiki-local-sync/dist/cli.js" --version
node "$release_plan/registry-install/node_modules/@neomei/agentwiki-local-sync/dist/cli.js" onboard start --help
```

`mkdir` 故意在目录已存在时失败，保证安装/缓存确为新目录。若重新执行，分配新的独立目录，不删除旧证据。npm 若要求安全密钥/OTP，由用户在真实认证界面完成；认证失败就保留候选，不能宣称发布完成。官方 tarball 必须 `cmp` 完全相同，安装后版本必须 0.13.2、依赖 protocol 必须 0.6.1。不要重复发布 protocol。

逐文件比对已安装包与已审 tarball（不仅 CLI --version）：

```bash
python3 - "$release_tgz" "$release_plan/registry-install/node_modules/@neomei/agentwiki-local-sync" <<'PY'
import hashlib,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[2]); count=0
with tarfile.open(sys.argv[1],'r:gz') as archive:
    for item in archive:
        if not item.isfile(): continue
        relative=pathlib.PurePosixPath(item.name).relative_to('package')
        assert '..' not in relative.parts
        data=archive.extractfile(item).read(); actual=(root/relative).read_bytes()
        assert actual==data, str(relative)
        count+=1
assert count==175
print({'installedFilesMatched':count})
PY
```

## D. 协调备份与不可变源码部署

协调备份可在npm发布二次认证等待期间先行，本轮备份已通过；下面备份命令为既有执行步骤，不应无故重复。正式部署仍须先完成npm正式发布及回读：

```bash
scp "$release_plan/backup-production.py" root@113.249.120.24:/tmp/agentwiki-backup-v01248.py
ssh root@113.249.120.24 'python3 /tmp/agentwiki-backup-v01248.py' > "$release_plan/backup-execution.jsonl"
```

从最后一个 `status: verified` 回执记录实际 `/var/backups/agentwiki/generic-mcp-v01248.*` 目录。确认 `checksumsPassed`、`writersRestored`、三服务 active、`pgRestoreListPassed`、附件归档与前后 manifest 相等。`application.tar.gz` 含构建与 `.env`，`configuration.tar.gz` 含两份环境和三份 service，均为私有文件；禁止传到公开仓库。备份后可能继续有用户写入，它们不在该快照内。

从固定 commit 单独导出部署源，避免本地后来改动或验收文件进入发布：

```bash
mkdir "$release_plan/export"
cd "$release_repo"
git --work-tree="$PWD" archive --format=tar "$release_sha" agentwiki | tar -xf - -C "$release_plan/export"
cd "$release_plan/export/agentwiki"
bash ./deploy.sh 113.249.120.24 root > "$release_plan/deploy.log" 2>&1
```

`deploy.sh` 会打包明确白名单源码、排除 `.env`/node_modules/dist，在远程创建 `/root/agentwiki-release.*` 并复制既有私有配置；按候选包版本设置两处 `LOCAL_SYNC_PACKAGE_VERSION=0.13.2`；安装锁定依赖、构建、保留旧前端 hashed assets、OpenCode preflight；停三个服务并排除旧 Node writer 后执行 `prisma migrate deploy`，再将旧应用移动到 `/root/agentwiki-previous-<timestamp>` 并激活候选。此版本没有新增迁移，任何发现的待执行非本候选迁移都需要先调查。

脚本本身不负责协调备份，C/D 不能省略前面的备份。`deploy.sh` 成功并不自动完成上线验收。必须记录输出的 previous 路径，备份和 previous 目录都保留。

## E. 源码、资源与生产验收

```bash
scp "$release_plan/source-manifest.json" root@113.249.120.24:/tmp/agentwiki-v01248-source-manifest.json
ssh root@113.249.120.24 'python3 -' > "$release_plan/production-source-check.json" <<'PY'
import hashlib,json,pathlib,subprocess
root=pathlib.Path('/root/agentwiki'); manifest=json.loads(pathlib.Path('/tmp/agentwiki-v01248-source-manifest.json').read_text())
for row in manifest['files']:
    data=(root/row['path']).read_bytes()
    assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256'],row['path']
versions={key:json.loads((root/path).read_text())['version'] for key,path in {'web':'package.json','api':'apps/server/package.json','client':'apps/client/package.json','localSync':'packages/local-sync/package.json','protocol':'packages/sync-protocol/package.json'}.items()}
assert versions=={'web':'0.12.48','api':'0.12.48','client':'0.12.48','localSync':'0.13.2','protocol':'0.6.1'}
health=json.loads(subprocess.check_output(['curl','-fsS','http://127.0.0.1:3000/api/health']))
assert all(health.get(k)=='ok' for k in ['status','database','redis','auditPersistence','attachmentStorage'])
services={unit:subprocess.check_output(['systemctl','--user','is-active',unit],text=True).strip() for unit in ['agentwiki-api.service','agentwiki-worker.service','agentwiki-frontend.service']}
print(json.dumps({'revision':manifest['revision'],'sourceFilesMatched':len(manifest['files']),'versions':versions,'health':health,'services':services}))
PY
curl -fsS https://agentwiki.quukk.com/api/health
curl -fsS https://agentwiki.quukk.com/api/onboard > "$release_plan/public-onboard.md"
```

已核对冻结 controller 的 `@Get('onboard')`，公开 Markdown 指令路径为 `/api/onboard`。检查公开指令固定 0.13.2 并出现 generic/WorkBuddy；浏览器打开真实接入页查看渲染，不以 curl 代替。

实际 WorkBuddy 最终门禁必须分别留证：官方 0.13.2 启动 → 系统自动打开真实授权 URL → 用户授权完成 → 配置写入且保留备份 → WorkBuddy 对该 MCP 权限/工具授权 → 正常退出并重启 → 新会话明确调用 AgentWiki MCP 的 `wiki_list_spaces` 和一个已知页的 `wiki_get_page` → 标题/内容/空间与真实页核对。旧连接读页不能代替新版本接入验收；本地 mock/fixture/SDK 都不替代宿主证据。

## F. 失败处理与恢复（独立人工决定，绝不自动执行 DB restore）

1. npm 成功而部署未成功：保留已发布包和候选；生产仍保持旧应用。不要撤销/删除已发布版本，不要求客户端盲目升级。
2. `deploy.sh` 在切换前失败：保留日志与其指出的 staging 目录，核对服务状态；不得直接重新运行旧应用并假定数据库未变。
3. 已切换但健康/读页失败：先判断是否可前向修复。在确认数据边界前，不运行 `pg_restore`。
4. 恢复旧快照会丢弃快照之后的用户写入。必须明确停写、保存一份新的故障现场 DB/附件/应用快照、列出回退数据窗口并取得恢复决定后才能继续。发布授权本身不是自动允许覆盖新写入的恢复授权。

以下是选定同一备份组后的人工恢复命令骨架，变量必须从本次回执填写，不能使用示例/空值：

```bash
# 在 root 生产维护 shell 内；此块不自动运行。
selected_backup='/var/backups/agentwiki/generic-mcp-v01248.<本次实际后缀>'
previous_app='/root/agentwiki-previous-<本次deploy.log实际时间>'
test -d "$selected_backup" && test ! -L "$selected_backup"
test -d "$previous_app" && test ! -L "$previous_app"
(cd "$selected_backup" && sha256sum -c SHA256SUMS)
pg_restore --list "$selected_backup/database.dump" >/dev/null
# 按 docs/operations/markdown-attachments.md 的 Coordinated restore and rollback
# 先停全部 writer、取得单独的最新故障快照，并保持停止。不要调用自动恢复writer的旧备份脚本。
systemctl --user stop agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service
systemctl --user show -p ActiveState -p MainPID agentwiki-api.service agentwiki-worker.service
```

数据库凭证通过 Node `util.parseEnv` 读取私有配置，再仅向子进程环境传 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`（沿用备份脚本），不能 `source .env` 或将数据库 URL写到命令行/日志。执行的恢复子命令为：

```text
pg_restore --clean --if-exists --exit-on-error --single-transaction --dbname=<私有 PGDATABASE 环境指定的数据库> <已校验、同组且暂存的 database.dump>
```

这条恢复命令须在上面数据窗口决定后单独调用，不能放在部署失败 trap 中。配对附件恢复按规程从同一 `attachments.tar.gz` 解包到 `/var/lib/agentwiki/attachments-restore.<新目录>/attachments`，验证每个 `sha256` blob 的路径/长度/hash 与备份 `attachment-manifest-after.json` 一致并检查无符号链接。保持同文件系统，再执行有明确目标的 rename：

```bash
# restore_bundle 与 failed_bundle 必须为本次独立 mktemp 目录，均在 /var/lib/agentwiki。
test "$(stat -c '%d' /var/lib/agentwiki/attachments)" = "$(stat -c '%d' "$restore_bundle/attachments")"
mv /var/lib/agentwiki/attachments "$failed_bundle/attachments"
mv "$restore_bundle/attachments" /var/lib/agentwiki/attachments
# 只改恢复树顶层 owner/mode，不能递归 chown 正在使用的附件根。
chmod 0700 /var/lib/agentwiki/attachments
# previous_app 必须逐文件匹配所选备份 source-manifest-before.json 后才允许激活。
mv /root/agentwiki "$failed_application"
mv "$previous_app" /root/agentwiki
systemctl --user daemon-reload
```

`failed_application` 必须是预留且不存在的独立路径。恢复后先按规程在 loopback 13000 运行私有健康探针、`prisma migrate status` 和附件 manifest 校验，保留正常 writer 停止；验证成功且操作人明确恢复服务后，再 `systemctl --user start` 三个服务并检查公网健康/已知受保护附件。不要混用另一轮 database.dump、附件和 previous 应用。现有备份归档可校验不代表此恢复流程已经演练。

## 2026-10-19 执行实况：npm与生产发布验证完成，真实新WorkBuddy验收进行中

- 冻结0a299231的发布与继续验收已获用户授权，授权持续有效。
- 初期npm E401/SSH缺失已恢复；首次publish独立安全密钥挑战超时E404保留历史。第二次认证成功、CLIexit0/PUT202经历官方Validating后，registry version/latest均为0.13.2；不能将此前上传接受时间误记为可安装时间。
- 官方tarball与冻结候选字节一致，SHA256 `836a92c65c9fae6ba3fbc181a6b861cbd4380517764291115b6ce45bc86556b9`；175文件逐项匹配，空目录/空缓存安装LocalSync0.13.2及protocol0.6.1通过。
- 协调备份 `/var/backups/agentwiki/generic-mcp-v01248.f0el29jz` verified/checksumsPassed/writersRestored；154blob匹配，writer暂停约7.114秒后恢复，备份后内外health通过。未执行恢复演练。
- 从固定commit导出的deploy.sh返回exit0，previous为`/root/agentwiki-previous-20261019004923`。host回执UTC2026-10-18T16:50:20验证1357源码全部匹配0a299231、Web/API/client0.12.48、LocalSync0.13.2、protocol0.6.1、Node24.18.0、3active/5healthok。
- 公网回执UTC2026-10-18T16:50:24验证HTML及5入口资源与生产exactmatch，公网5healthok。公开`/api/onboard`指令含generic/WorkBuddy和固定0.13.2；真实Chrome指南渲染通用默认、WorkBuddy、自动打开浏览器及客户端权限/重启说明。
- 当前真实新WorkBuddy授权、权限、新配置生效、重启和新会话MCP读页正在执行；未标记complete，旧连接读页和指南渲染不替代此最终验收。
- 正式脱敏回执 `release.json`，分阶段历史 `release-progress.json`；原始本地`registry-verified.json`、`production-source-check.json`、`public-release.json`、`backup-receipt.json`保留。私有截图不提交。
- npm/生产发布无需重复执行。保留备份与previous应用；快照后用户写入不在恢复点内，不自动回滚覆盖。
