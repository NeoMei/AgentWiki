# AgentWiki Sync 0.5.7 发布记录

状态：**0.5.7 已正式发布**；main / tag / 已下载三资产 / provenance 已读回一致。未安装日常 Vault。

## 候选

- 仓库：`NeoMei/agentwiki-sync`；默认分支 `main`。
- 远端基线及最新 Release `0.5.6`：`ece5544ec3e33f53f79705060077423748c01844`。发布前已读回远端，未发现新增提交或 `0.5.7` tag。
- 功能候选：`d1d89de8270c2a629886d4b1688375d2d3dc8825`。
- 版本候选：`324fa53b3990fe276ebb1f12b4627a51e8a6b049`。
- 版本增量仅包含 `package.json`、`package-lock.json`、`manifest.json`、`versions.json`、release 元数据测试、`CHANGELOG.md`、`docs/releases/0.5.7.md`。
- 运行时依赖、最低 Obsidian 版本 `1.11.5`、发布工作流保持原样。

## 本地验证

- `npm run check` exit 0：格式、lint、typecheck、69 files / 1418 tests、production build、bundle safety、release metadata 均通过；lint 为 0 errors / 19 既有 warnings。
- `npm audit --omit=dev --json` exit 0：运行时依赖审计 0 漏洞。此数值不包含开发依赖。
- `git diff --check` 通过，候选 worktree 干净。
- 日志：`/tmp/agentwiki-sync-0.5.7-check.log`、`/tmp/agentwiki-sync-0.5.7-audit.json`。
- 冻结资产与日志副本：插件候选 worktree `.superpowers/releases/0.5.7-local/`。

| 资产 | 本地、正式下载与 GitHub digest 一致的 SHA-256 |
| --- | --- |
| `main.js`（1747313 bytes） | `e53fd66baec0a39ab1e6336382ca00c59d565e519f1eca4706746512b0295821` |
| `manifest.json` | `9a15644ff67f111977937b231178325439f0a10aa1166f1415a6bd677016faf9` |
| `styles.css` | `5dfe15839220724a57a64ad7ab136761ba2ffaaff3c0235faac1cf1238e762b8` |

## 已知验收边界

本轮 macOS 隔离 Vault 已验证功能候选 `e5b8a3a2624b5208d16a656d15ccd194d2805fd7` 的 Sync v2 首次同步、三级映射目录自动创建和原生文件回读。该原生包 SHA 为 `5d170a372a574bd8c63abcbd6d56ca7ce17f2aef4d0be45eee4748174c1365a6`；后续 `d1d89de` 仅补充中英文错误提示，`324fa53` 仅更新发布元数据与文档。不得把此前原生包表述为本次正式下载包的原生验收。

原测试者 `UNKNOWN_PARENT` 现场、Windows 原生、本轮 Sync v3 原生以及本次目录删除/远端后代新增冲突的原生 GUI 选择仍待验；相关树合并边界已有自动回归与源码独审。发布授权允许在明确保留这些边界的前提下发布。未安装或操作日常 Vault，未修改网页生产环境。

## 正式发布回执

- 独立版本复审：`plugin-release-review.md`，C/I/M = 0/0/0，Approved。之前功能源码复审继续有效。
- 本地主仓 `main` fast-forward；一次 `git push --atomic origin main refs/tags/0.5.7` 完成主分支与标签推送，无强推。远端再次读回 main/tag 均为 `324fa53b3990fe276ebb1f12b4627a51e8a6b049`，无额外合并提交。
- 正式 Release：[0.5.7](https://github.com/NeoMei/agentwiki-sync/releases/tag/0.5.7)，发布时间 `2026-10-08T14:16:20Z`（北京时间 22:16:20）；latest API 为 0.5.7，draft=false / prerelease=false。公开 Release 页面 HTTP 200，正文读回含本次修复、原生候选身份与待验边界。
- [Release workflow](https://github.com/NeoMei/agentwiki-sync/actions/runs/37790961030) success；精确 head `324fa53b`。日志确认 1418 tests、bundle safety 1747313 bytes、release metadata 0.5.7；attestation 与发布步骤通过。
- [Main CI](https://github.com/NeoMei/agentwiki-sync/actions/runs/37790961101) success，同一 head。
- 使用 `gh release download 0.5.7` 实际下载 `main.js`、`manifest.json`、`styles.css` 到候选 worktree `.superpowers/releases/0.5.7-downloaded/`。三文件逐字节等于本地冻结资产，SHA-256 与 GitHub Release digest 一致（见上表）；manifest 实际版本 0.5.7。
- 三资产分别执行 `gh attestation verify`，限定 repo `NeoMei/agentwiki-sync`、signer `.github/workflows/release.yml`、source digest `324fa53b3990fe276ebb1f12b4627a51e8a6b049`、source ref `refs/tags/0.5.7`、GitHub hosted runner，全部 exit 0。随后再次读取证书确认精确 SHA/ref/signer/runner 一致。
- 发布工作流使用仓库 `docs/releases/0.5.7.md` 的 notes-file 正式创建 Release，没有并发手工创建、没有 PR、没有安装或操作日常 Vault、没有网页生产变更。

完整证据保留在候选 worktree `.superpowers/releases/0.5.7-local/`：`github-release.json`、`github-ci.json`、`download-verification.json`、三个 `*.attestation.json`、本地 check/audit 与正式 Release 日志。未清理该 worktree，供后续检查和受控安装使用。正式包的原生安装/交互验收未在发布步骤中重跑，不扩大此前原生证据范围。
