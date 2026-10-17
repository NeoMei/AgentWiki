# AgentWiki Sync 0.5.12 正式发布回执

日期：2026-10-17。官方 GitHub Release 已发布，源码、CI、三个下载资产及来源证明均已验证。本回执只证明插件正式发布和包身份；原反馈 Windows Vault 场景仍待验。

## 发布身份

- 仓库：`NeoMei/agentwiki-sync`，正式版本/tag：`0.5.12`（无 `v`）。
- 源码：`fd06387b121aeb1db02b08cc290a077fc8d267e7`；注释 tag 对象：`c81de844d94ac09d3136a3f87f2ec0473467d823`。
- 已审查产品候选：`15c37be433a444a00bb52936cba6affa0de832e4`。发布提交仅更新 7 个版本、变更日志和发布说明文件；未更改 runtime 或依赖版本。
- 远端 main 从 `200670106282f23cd2c1e29cfc6ede40e5287fba` 正常快进到正式源码，与 tag 原子推送；没有 force push，也没有覆盖他人修改。
- [正式 GitHub Release](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.12)：`2026-10-17T04:25:45Z` 发布，非 draft、非 prerelease。已回读发布正文，包含仓库 release notes 的完整内容。

## 检查与发布工作流

- 干净 `npm ci` 后完整 `npm run check` 退出 0：75 文件 / 1551 项测试通过，格式、类型、production build、bundle safety 和 0.5.12 版本元数据全部通过；lint 0 errors / 20 warnings。
- 发布元数据独立审查：P1 0 / P2 0。被 `releases/` 忽略规则命中的 `docs/releases/0.5.12.md` 已显式加入提交，并确认工作流使用该正文。
- [Release 工作流 39002468357](https://github.com/NeoMei/agentwiki-sync/actions/runs/39002468357)：completed/success；GitHub 托管 Ubuntu 上执行 Node 24、`npm ci`、完整 `npm run check`（75 / 1551）、资产 attest 和正式发布。
- [main CI 39002468403](https://github.com/NeoMei/agentwiki-sync/actions/runs/39002468403)、[tag CI 39002468461](https://github.com/NeoMei/agentwiki-sync/actions/runs/39002468461)：均 completed/success。
- 最终回执独立审查：P1 0 / P2 0；tag/source、CI、三资产字节与哈希、来源证明及 Windows 待验边界一致。
- 依赖锁文件仅变更根版本号。生产依赖 `npm audit --omit=dev` 为 0；现有开发依赖审计 10 项（5 moderate、3 high、2 critical，含 Vitest/tinypool），本次未扩大范围执行依赖升级。

## 官方资产

已实际下载三个正式 release 资产；逐字节等于本地干净 npm 构建，SHA-256 与 GitHub asset digest 一致。

| 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| main.js | 1785587 | `cb7ad672e2183b148673acf697ca19e64eb7e0b4ae6febd6ca139b000ef250f7` |
| manifest.json | 233 | `0402a93982e1efc857751869c23c4f01f0114697a77ee5c326c6b5ac5deb3995` |
| styles.css | 4880 | `5dfe15839220724a57a64ad7ab136761ba2ffaaff3c0235faac1cf1238e762b8` |

三个资产分别执行 `gh attestation verify` 均退出 0，限定仓库 `NeoMei/agentwiki-sync`、签名 workflow `.github/workflows/release.yml`、source ref `refs/tags/0.5.12`、source digest 为上述正式源码，并拒绝 self-hosted runner。证书回读确认 GitHub 托管 runner、同一源码和 Release run 39002468357。

## 验收边界

- 本轮未升级或修改用户日常 Vault，未连接真实同步账户，未删除或重置事务。
- 本轮没有进行官方包的原生安装；此前 macOS 临时 Vault synthetic UI 验收另行记录，不替代原 Windows Vault 附件超限/恢复失败重放。
- 原 Windows 反馈场景保持待验，不因发布、测试或资产验证成功而称为业务同步完成。

结构化回执及每个资产的下载 URL、来源证明字段见 [plugin-release.json](plugin-release.json)。完整检查日志、GitHub CI 日志及下载/attestation 原始输出保存在插件工作树 ignored `.superpowers/release-0.5.12-*` 文件中；本回执不含凭据或私人 Vault 内容。
