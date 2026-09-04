# macOS release verification

## 目标

- 在 Mac 上拉取已发布的 Windows 修复候选，使用隔离 PostgreSQL/pgvector、Redis AOF、真实 CodeGraph 和 Chrome 补齐 Windows 主机无法执行的数据库、外部运行时和 25 个 Playwright 用例。

## 当前状态

- 2026-09-04 完成，最终结论 PASS；已测试代码为 `e8c16e92822758a75350e50d9abb7865cc970f54`。
- clean clone 全仓 4170 pass / 0 fail / 3 个平台或显式 opt-in skip；typecheck、lint、build、裸 audit 与数据库/Redis skip gate 均通过。
- 真实 CodeGraph standard scan 1/1；真实 Chrome Playwright 25/25，单 worker、无 retry。
- protected public digest 不变；所有目标前缀 schema 为 0；进程组、容器、四个端口和原附件路径均完成精确清理。
- 正式证据：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`。

## 完成条件

- 数据库相关测试不再因缺少环境变量跳过，所有执行门禁零失败。
- 真实 CodeGraph 标准扫描通过；若 Mac 也缺少独立 CodeGraph 安装，必须继续明确标记为外部阻塞。
- Playwright 收集 7 files / 25 tests，并执行 25 passed / 0 failed / 0 skipped。
- 测试 schema、临时附件、容器和端口全部清理，形成 macOS 验证记录。

## 完成结果

- 四项完成条件全部满足，任务从 active 转入 archive。
- 附件没有 broad 删除，保存在 `/Users/neomei/.Trash/agentwiki-macos-release-task6.EP25nx/agentwiki-mac-attachments.DLF925`，可恢复。
- 任务只创建本地证据提交；未 push、未发布 npm、未部署生产。
