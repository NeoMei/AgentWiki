# AgentWiki Local Sync 0.4.0 发布验证

日期：2026-08-20

## 发布对象

- npm：`@neomei/agentwiki-local-sync@0.4.0`
- npm dist-tag：`latest = 0.4.0`
- GitHub release source：`11adb597b6c2019b6eedfacf0a891df2b2d6f73a`
- 生产：`https://agentwiki.quukk.com`

## 本地与发布包验证

- 完整矩阵：runtime 72 pass / 40 database-config skips、server 583、client 203、sync-protocol 22、local-sync 718；lint、typecheck、build、`git diff --check` 全部通过。
- 真实 CodeGraph 1.5.0 标准扫描 E2E 1/1；Codex、Claude Code、OpenCode onboarding harness 8/8。
- 官方 `Node v26.7.0` Darwin arm64 包按 `SHASUMS256.txt` 校验后，runtime contract 与 local-sync 718/718 通过；临时运行时随后删除。
- 发布 tarball SHA-1：`ec07b5800280daf3c41de5b415fb6ee5110458f2`。
- 发布 tarball SHA-256：`16ac71d2f5d363db15a45166eb6a7ac87c9b30c91f83aff0f8a4215e76e97700`。
- npm integrity：`sha512-4N4yWI1bPFE4PM4YOl0E3k8FYulsy/+j22mDoC/kvRsiErkxQ0H25zqwZBtHe7AD90+jKik+Ke7ty6tsoGl+Jg==`。
- 从公开 registry 全新安装后，CLI 报告 `0.4.0`，仅暴露 `onboard|gateway|doctor|uninstall`；CodeGraph 私有子路径均为 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

## 生产部署验证

- 部署前正确的 AgentWiki PostgreSQL custom dump：`/root/backups/agentwiki/pre-local-sync-0.4.0-20260820-110807.dump`，SHA-256 `799170cd0ee0f10f3f6da66d4add908622c5f308e98273ae8d3e46031d4d98ee`。
- 部署前应用回滚包：`/root/backups/agentwiki/pre-local-sync-0.4.0-20260820-110807-app.tar.gz`，SHA-256 `be2204806d1763977c5fc26b0e97e237b93f4a4358e602063d06994acdc70b23`。
- 两份备份均通过格式/目录与 SHA-256 复核，权限为 `0600`。
- 远端 package、provider、pipeline、onboard controller 四个关键文件的 SHA-256 与本地逐项一致。
- 34 个 Prisma 迁移均已应用；API、Worker、Frontend 为 `active/running` 且 `NRestarts=0`。
- `/api/health` 的 database、Redis、audit persistence 均为 `ok`；`/api/onboard` 为 200 且公告 `0.4.0`，`/api/onboard.json` 为预期 410 并指向 `0.4.0`，首页为 200。
- API smoke 18/18；UI smoke 为公开 5、认证 16、移动 6 路由；临时 user、Space、Agent 活跃残留均为 0。
- 启动后的两条 ERROR 日志是 smoke 明确验证的错误密码 401 与重复注册 409；没有其他持续运行错误。
- 同机 LLMRouter、new-api、PostgreSQL、Redis 等既有服务未被重启或改动。
