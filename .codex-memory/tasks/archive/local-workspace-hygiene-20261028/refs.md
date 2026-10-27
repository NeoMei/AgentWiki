# 证据与恢复

- 本地归档根目录：`/Users/neomei/.local/share/agentwiki-local-archives/20261028/`
- 原状态：`manifest.json`、`worktree-audit-before.json`、`legacy/`、`canonical/`
- 9 个恢复分支映射：`snapshot-branches.json`；各 dirty 工作树有 binary patch、原 staged patch、文件 tar 与 SHA-256 清单。
- 旧主目录原工作状态提交：`b0b3a44289eebfcee8592fea94722764372e0c13`，原 HEAD `c8424dd61523f1d1452e0e6c81415aa1b4e998d0`。
- 正式发布源码：v0.12.63 / `c4fe12bda31e41c355735cd0d09dbcad834c30b5`；整理前 HEAD `ac603a0d2f75aa56c1c9a91aee1ecf557eb93678`。
- 发布证据：`agentwiki/docs/verification/bug-release-v01263-20261027/`；.26 索引修正依据 `agentwiki/docs/verification/release-v01226-20261014/status.md`。
- 恢复时先在新目录查看恢复分支或 bundle，避免覆盖现行工作区；原 index 与 HEAD 信息已独立保存。登记备份仅用于人工检查，不覆盖当前登记。
