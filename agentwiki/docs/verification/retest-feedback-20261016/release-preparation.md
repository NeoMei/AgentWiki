# Web 0.12.45 发布准备

状态：候选 02157186 的五项 Web 修复与新增服务端历史链兼容修复均通过独立审查，最终发布门禁通过；配套备份、推送、正式 GitHub Release 和生产部署均已完成。1351源码/hash、编译模块、内外health、三服务、63迁移、公网入口资源和32项业务smoke通过，见 deployment.json。用户已授权继续修复和发布，并恢复 SSH 登录。

## 配套备份回执

备份已于2026-10-16T06:21:31Z完成，API/Worker停写约7秒后恢复。PostgreSQL custom dump、应用、配置和154个永久附件blob已成组校验，`pg_restore --list`与SHA256清单通过，三个服务均active。回执见backup-receipt.json；没有执行恢复演练。

## 最终候选更新

- 原版本准备之后加入服务端补丁 65e91103 及测试清理 02157186，修复 Windows 官方 0.5.10 v2/head 的 REVISION_GONE；不改库、不重建基线，严格校验保留。固定 HEAD 独立审查 PASS，见 server-chain-review.md。
- 最终 `pnpm test:full` exit0：runtime309/1skip、DB239/0skip、server3301/4skip、client2657、protocol140、local-sync998/1skip，合计7644通过/6既有跳过/0失败。最终 typecheck、lint、build 均exit0；初始JS预算仍548270/550000。
- 旧版准备中的“产品未变、7624门禁”只描述264c64fd阶段，不覆盖上述新增修复；最终证据以 validation.json 为准。

## 集成与版本

- 读取远端默认分支 `master`，当前 `origin/master` 为 `5c9d52cfa2d4d71541c709b589b633e6c36fa9b5`；GitHub 最新正式版本仍是 `v0.12.44`。准备时 `refs/tags/v0.12.45` 不存在，发布前须再核对。
- 候选原 HEAD `8bc70dc1`，基线产品 `35f73159`。远端只多了一个 v0.12.44 生产回执文档提交，无产品、依赖、Prisma 或部署脚本变更。
- 集成提交 `c7dfce0d` 保留两边历史。唯一冲突是 `.codex-memory/current.md`，保留本轮任务状态并补充 v0.12.44 生产回执索引；其余两个上游回执文件原样合入。
- 根包、client、server 的版本均为 `0.12.45`，三个 JSON 仅改变 version；Local Sync `0.13.0`、protocol `0.6.1`、锁文件、数据库结构和部署脚本均不变，无 npm 发布步骤。

## 已完成门禁

- 产品与测试文件相对于原已审查候选 `07d6abc9` 保持不变；原完整门禁仍适用：7624 通过 / 6 既有跳过 / 0 失败，逐任务及整分支独立审查通过。
- 版本准备后重新执行 `pnpm build` 与 `pnpm typecheck`，均 exit 0。initial JavaScript `548270 / 550000` bytes；已知 lazy parser chunk 提示不影响预算通过。
- `git diff --check` 通过。相对于上游没有 `packages/`、锁文件、Prisma schema/migrations 或 deploy.sh 差异。
- 构建日志 `/tmp/agentwiki-retest-v01245-build.log`，类型检查日志 `/tmp/agentwiki-retest-v01245-typecheck.log`。没有为仅文档集成和 version 字段变更重复整仓 7624 项。

## 生产只读基线

- SSH 恢复后实读 root uid 0、Node `v24.18.0`，三个 systemd 服务均 active。
- 生产 Web / client / API 均为 `0.12.44`，Local Sync `0.13.0`、protocol `0.6.1`。对发布源码 `35f73159620feb8ac82a137cc64aed7928ab5717` 的 **1345 个文件**逐个核对长度和 SHA-256，无不匹配；见 [production-baseline.json](production-baseline.json)。
- 本机和公网 health 的 status/database/redis/auditPersistence/attachmentStorage 均 ok。公网 HTML 引用的五个入口资源全部与实读生产 hash 一致，主入口为 `index-DohJ8yzG.js`。
- 只读查询确认 Prisma 预期与已应用迁移均 63 个，无 pending 或未结束记录。附件路径配置正确、无符号链接、权限 0700，当前永久 blob 154 个；备份根目录 0700、非符号链接，可用空间超过 327 GB。
- 本阶段未修改生产应用、配置、数据、附件或服务状态。

## 备份与部署入口

1. 独立审查本次不可变候选及发布元数据；发布动作前再次 fetch/核对远端与版本占用，不覆盖其他聊天的新提交。
2. 配套备份遵循 `docs/operations/markdown-attachments.md`。已按最近一次 v0.12.44 备份脚本准备本轮脚本 `/tmp/agentwiki-retest-release-20261016/backup-production.py`，仅替换目标前缀、预期旧版本和旧源码引用，语法检查通过；尚未执行。
3. 备份脚本要求生产仍为 0.12.44，持有部署锁；先归档应用/配置，再停止 API 和 Worker 并核实 inactive / MainPID=0，同时获取 PostgreSQL custom dump 和完整附件归档；校验 `pg_restore --list`、附件前后及归档内 blob manifest、SHA256SUMS，然后恢复两个 writer。异常路径也尝试恢复 writer。备份位于 `/var/backups/agentwiki/retest-feedback-v01245.*`，目录 0700、私有文件 0600，不进入公开仓库。备份可列出和校验并不代表实际恢复演练。
4. 部署入口为应用根 `deploy.sh <已核实生产主机> root`，使用当前有效 `AGENTWIKI_SSH_CONTROL_PATH`。脚本自身不创建上述配套备份。它在新目录冻结依赖、显式生成 Prisma Client 并构建，保留旧静态资源，通过 runtime preflight 后停止服务、执行 migrate deploy、交换目录并重启三服务；旧应用目录保留用于配套恢复。
5. 部署后逐个验证候选源码和公网资产 hash、三服务及 health、32 项业务烟测，并做五项对应的原生浏览器验证；临时验收数据要精确清理。保留生产上线与原报告逐项复验的独立结论，不以部署成功代替原案关闭。

本轮仅准备 Web 发布。Obsidian 官方 0.5.10 与 Windows 错误定位独立记录，不将旧已撤回插件候选合入。
