# macOS release verification

## 目标

- 在 Mac 上拉取已发布的 Windows 修复候选，使用隔离 PostgreSQL/pgvector、Redis AOF、真实 CodeGraph 和 Chrome 补齐 Windows 主机无法执行的数据库、外部运行时和 25 个 Playwright 用例。

## 当前状态

- 2026-09-04 完成最终审查修复波，最终结论 PASS；已测试代码为 `23a25f888b76b9ce4b8a8cc76dd5164e1c80034b`。
- clean clone 全仓 4208 pass / 0 fail / 3 个平台或显式 opt-in skip（4211 total）；typecheck、lint、build、裸 audit 与数据库/Redis skip gate 均通过。
- 真实 CodeGraph standard scan 1/1；真实 Chrome Playwright 25/25，单 worker、无 retry。
- protected public digest `79642c9fc9d560bdbadd4828bcb75b6796a0a56ec1c45638d1e6d9ddd2b0e2e3` 不变；所有目标前缀 schema 为 0；进程组、容器、四个端口和原附件路径均完成精确清理。
- 正式证据：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`。

## 完成条件

- 数据库相关测试不再因缺少环境变量跳过，所有执行门禁零失败。
- 真实 CodeGraph 标准扫描通过；若 Mac 也缺少独立 CodeGraph 安装，必须继续明确标记为外部阻塞。
- Playwright 收集 7 files / 25 tests，并执行 25 passed / 0 failed / 0 skipped。
- 测试 schema、临时附件、容器和端口全部清理，形成 macOS 验证记录。

## 完成结果

- 四项完成条件全部满足，任务从 active 转入 archive。
- 附件没有 broad 删除，保存在 `/Users/neomei/.Trash/agentwiki-macos-finalfix.pG4uH2/agentwiki-mac-attachments.F8pAW8`，可恢复。
- 任务创建本地代码提交与独立证据提交；未 push、未发布 npm、未部署生产。
