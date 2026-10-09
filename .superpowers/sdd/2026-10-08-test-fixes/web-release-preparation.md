# 网页 0.12.17 发布元数据准备

日期：2026-10-08。分支：`codex/test-fixes-20261008`。准备基线：`4959427f9ee74a5aae26fbbd7a6e272154101f72`，产品源码：`d6c3934a609590ffbc1cf0e27f7c650ed5113f9c`。

## 范围

- `agentwiki/package.json`、`apps/client/package.json`、`apps/server/package.json` 的应用版本从 `0.12.16` 更新为 `0.12.17`。
- 新增 `agentwiki/docs/releases-v0.12.17.md`，按六组实现记录修复、协作 lookup 按需加载、独立插件 `0.5.7` 及证据边界；README 顶部同步指向新版本记录，不提前声明远端发布完成。
- Local Sync `0.11.0`、同步协议 `0.6.1` 保持。相对生产基线 `d78c4af9803068216486258f2c4fcc971c38c766`，这两个包和 Prisma 目录均无差异；本次无需新增迁移或 npm 发布。
- pnpm 锁文件不包含上述应用包的自身版本，依赖未改，不需要修改锁文件。
- 不修改产品源码、部署脚本、`docs/verification` 或 `.codex-memory`。未推送、打 tag、创建远端 Release、部署、读取生产凭据或操作生产 UI。

## 验证

在版本字段更新后的本地工作树运行：

|命令|结果|
|---|---|
|`node --test --test-name-pattern='application release versions and independent sync versions stay aligned\|onboard controller' scripts/node-runtime-contract.test.mjs`|2 通过，0 失败，0 跳过；应用版本一致，独立同步包版本和接入命令保持|
|`pnpm --filter @agentwiki/server typecheck`|通过；`tsc --noEmit --incremental false`，退出码 0|
|`pnpm --filter @agentwiki/client exec tsc --noEmit`|通过，退出码 0|
|`git --work-tree='<此工作树>' diff --check`|通过|

Node `24.18.0`，pnpm `11.9.0`。pnpm 因 package 元数据变化自动校验当前锁文件并执行既有 postinstall 的 Prisma Client generate；依赖分辨率、锁文件、schema 均未改变。没有运行完整 build，避免与发布主流程并发写构建产物；完整 test/build 由主代理在冻结版本提交后执行。

## 文案边界复核

- 六组修复包含五组网页功能与独立 Obsidian 插件组，未把插件实现写成网页包内改动。
- 已有全仓测试属于 `167237a1`；最后 lookup 增量、客户端回归及构建属于 `d6c3934a`，未将旧测试数量映射为本次发布提交已重跑。
- 保留原始 Obsidian `UNKNOWN_PARENT`、原黄金书屋 Space、原运行、原文路径、原生中文 IME、真实 provider 和部分插件原生平台待验；未宣称原报告 15 项按原环境全部复验。
- Space 权限、allowlist、显式保存、审核冲突限制及旧运行深链接保持。已有 lint/audit/build warning 单列，不声称消除。

独立元数据审查和冻结提交后的发布门禁、推送、Release、部署由主代理继续执行并记录。
