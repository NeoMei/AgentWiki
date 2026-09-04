# 参考

- Mac 执行清单：`agentwiki/docs/superpowers/plans/2026-09-04-macos-release-verification.md`
- 已发布 Windows 修复代码候选：`7db186b fix(windows): complete release-readiness remediation`
- Windows 验收计划：`agentwiki/docs/superpowers/plans/2026-09-03-release-readiness-audit.md`
- Windows 当前证据：4044 passed / 79 skipped / 0 failed；typecheck、lint、build、audit、Browser 通过。
- Playwright 基线：7 files / 25 tests，可收集但 Windows 缺少真实数据库栈。
- Redis 持久性要求：`agentwiki/docs/operations/redis-audit-durability.md`
- CodeGraph 验收说明：`agentwiki/docs/verification/codegraph-standard-scan-cutover.md`
- 最终已测试代码：`e8c16e92822758a75350e50d9abb7865cc970f54`
- macOS 正式验证记录：`agentwiki/docs/verification/macos-release-validation-2026-09-04.md`
- Task 1-5 准确证据：`.superpowers/sdd/2026-09-04-macos-release-verification/task-{1,2,3,4,5}-report.md`
- Task 5 清理句柄：`.superpowers/sdd/2026-09-04-macos-release-verification/task-5-runtime.env`
- protected public inventory digest：`d78ab0b1f0708f8d72c170a6a756eeaeb20259d6058f36d092b6cf0232c4592f`
- CodeGraph 完整输出：`.superpowers/sdd/2026-09-04-macos-release-verification/artifacts/task-4-codegraph-standard-scan.log`
- Task 5 最终 Playwright：`/tmp/agentwiki-mac-playwright-run-mac_e2e_20260904110258_2487-fix-round1.log`
- Task 5 最终进程快照：`/tmp/agentwiki-mac-service-process-group-mac_e2e_20260904110258_2487-fix-round1.log`
- 可恢复附件：`/Users/neomei/.Trash/agentwiki-macos-release-task6.EP25nx/agentwiki-mac-attachments.DLF925`
