# 0.12.60 发布工具

这些脚本的准备与语法校验不会发布或备份生产。产品真实用例通过、候选提交冻结后，再按下面顺序运行。发布过程中不得把工作区未提交文件打包进去。

## 文件与边界

- `prepare-source-manifest.py`：从明确的 Git commit 读取 `deploy.sh` 打包白名单的源码，输出逐文件 SHA-256、字节数和独立 verifier。只接受应用三处版本 0.12.60、local-sync 0.13.5、protocol 0.6.1。不会读取 `.env` 或连接生产；输出目录必须不存在。
- `verify-release.py`：固定 SHA、manifest 摘要与文件数均由命令行显式传入。host 模式检查 `/root/agentwiki` 的每一个 manifest 文件、版本、三个服务、Node 24/26、健康接口与前端入口资源；public 模式从另一台机器比对公开入口、资源哈希和健康接口。检查器复用已冻结的 `notification-unread-20261023/verify-release.py`；生成器会把它嵌入独立副本。
- `backup-production-v01260.sh`：复制 2026-10-25 已使用的备份程序，只更名备份前缀和数据库应用标签。取得 `/root/.agentwiki-deploy.lock`，备份应用及配置，暂停 API/Worker，制作数据库与附件的一致快照，核对清单/校验和，并恢复服务；出错或中断也尝试恢复原先活跃的写入服务。备份目录权限 0700，文件默认 0600。**运行会短暂停止写入服务；备份含配置凭据，保留在服务器私有目录，不放入 Git。**

备份程序记录当前现场，不声称当前现场完整对应某个旧 Git SHA。当前线上还包含 0.12.59 后的品牌源码覆盖；不可使用写死 0.12.58 baseline 的旧 Python 备份程序。

## 冻结源码与生成清单

以下占位符必须替换为已验收提交的完整 40 位 SHA；此提交必须包含本目录生成器与 verifier。

```sh
release_repo='/Users/neomei/.codex/worktrees/agentwiki-autochat-external'
release_sha='<完整40位冻结提交SHA>'
release_tree="/tmp/agentwiki-v01260-tree-$release_sha"
release_receipts="/tmp/agentwiki-v01260-receipts-$release_sha"
git -C "$release_repo" worktree add --detach "$release_tree" "$release_sha"
cd "$release_tree/agentwiki"
node scripts/agentwiki-release-guard.mjs
python3 docs/verification/agent-failure-20261026/prepare-source-manifest.py \
  --repo "$release_repo" --revision "$release_sha" --out-dir "$release_receipts"
```

部署必须从这个干净的 detached worktree 运行。单独 `git archive` 到无 Git 的目录无法通过当前 release guard。`AGENTWIKI_RELEASE_CANDIDATE` 是本地发布锁，当前 `deploy.sh` 不把它发送到服务器。

## 备份与部署（会改变生产状态）

```sh
scp docs/verification/agent-failure-20261026/backup-production-v01260.sh \
  root@113.249.120.24:/tmp/agentwiki-backup-v01260.sh
ssh root@113.249.120.24 'bash /tmp/agentwiki-backup-v01260.sh' \
  > "$release_receipts/backup-execution.log" 2>&1
```

先确认命令成功、输出包含 `Backup verified; services restored:`，并保留对应 `/var/backups/agentwiki/agent-failure-v01260.*` 路径。再运行：

```sh
bash ./deploy.sh 113.249.120.24 root > "$release_receipts/deploy.log" 2>&1
```

`deploy.sh` 会在远端构建、预检 OpenCode、停止旧进程、执行 migration、替换应用树并检查服务。它本身不会生成上面的协调备份。旧应用树保留为 `/root/agentwiki-previous-*`；不得未经核对就把它与当前数据库混用。

## 独立逐文件验证

生成器的 `preparation-receipt.json` 给出 `revision`、`manifestSha256`、`sourceFiles`、`verifierSha256`。以下值只能从该回执读取，不从当前工作区或线上页面猜测：

```sh
release_manifest_hash="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["manifestSha256"])' "$release_receipts/preparation-receipt.json")"
release_file_count="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sourceFiles"])' "$release_receipts/preparation-receipt.json")"
scp "$release_receipts/source-manifest.json" root@113.249.120.24:/tmp/agentwiki-v01260-source-manifest.json
scp "$release_receipts/verify-release.py" root@113.249.120.24:/tmp/agentwiki-v01260-verify-release.py
ssh root@113.249.120.24 python3 /tmp/agentwiki-v01260-verify-release.py \
  --mode host --revision "$release_sha" --manifest-sha256 "$release_manifest_hash" \
  --expected-files "$release_file_count" --manifest /tmp/agentwiki-v01260-source-manifest.json \
  > "$release_receipts/production-host.json"
python3 "$release_receipts/verify-release.py" --mode public --revision "$release_sha" \
  --manifest-sha256 "$release_manifest_hash" --expected-files "$release_file_count" \
  --host-receipt "$release_receipts/production-host.json" > "$release_receipts/production-public.json"
```

两份回执必须 `status=passed`。这证明冻结源码、服务、公开前端一致；原始 Agent 用例成功与保存验收仍应单独保留其运行回执。
