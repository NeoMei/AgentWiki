# 决策记录

## 2026-08-14

- 独立建立 `@neomei/agentwiki-sync-protocol` 包，不复用 `packages/local-sync` 的 `node:crypto` hash，因其 Node 专用且换行语义与契约冲突。
- 协议包内嵌 Unicode 15.1 CaseFolding.txt，不依赖 `unicode-case-folding@1.1.1`（其数据为 "latest"，不满足契约固定版本约束）。
- 实施顺序：协议包 → 人类设备身份 → sync v1 与迁移，严格按契约 5.2 Release A / Release B。
