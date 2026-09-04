# macOS release verification

## 目标

- 在 Mac 上拉取已发布的 Windows 修复候选，使用隔离 PostgreSQL/pgvector、Redis AOF、真实 CodeGraph 和 Chrome 补齐 Windows 主机无法执行的数据库、外部运行时和 25 个 Playwright 用例。

## 当前状态

- Windows 侧已完成 4044 passed / 79 skipped / 0 failed、typecheck、lint、build、依赖审计和公开 UI Chromium 验收。
- Mac 执行清单已写入 `agentwiki/docs/superpowers/plans/2026-09-04-macos-release-verification.md`。
- 等待 Mac 从 `origin/master` 拉取本轮候选并执行清单。

## 完成条件

- 数据库相关测试不再因缺少环境变量跳过，所有执行门禁零失败。
- 真实 CodeGraph 标准扫描通过；若 Mac 也缺少独立 CodeGraph 安装，必须继续明确标记为外部阻塞。
- Playwright 收集 7 files / 25 tests，并执行 25 passed / 0 failed / 0 skipped。
- 测试 schema、临时附件、容器和端口全部清理，形成 macOS 验证记录。
