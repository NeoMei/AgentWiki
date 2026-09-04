# Final release candidate audit

## 目标

- 全面审计 `origin/master..HEAD` 的任务完整性、代码正确性、前后端功能与 UI 交互，经过多轮发现、修复、复审和新鲜验证后得出最终结论。

## 完成状态

- 2026-09-04 完成；最终不可变代码提交为 `e94fa7ba0b2a49f39a19be8405b582e213ec4c88`。
- 首轮三视角、每批修复后的 scoped re-review 和最终整分支复核均完成；当前 Critical 0 / Important 0 / 值得修复的 Minor 0。
- 工作树和全新 `--no-local` clean clone 的 `pnpm test:full` 均为 4265 total / 4262 pass / 0 fail / 3 skip。
- typecheck、lint、build、真实 CodeGraph、`git diff --check` 全绿；工作树裸 audit 为零已知漏洞。
- 最终 Playwright 8 files / 26 tests，单 worker、无 retry，26/26；协作精确 eventSequence 和 390px 布局增强后重复 2/2。
- protected inventory 前后一致；测试 schema、临时数据库、进程、容器和本轮端口占用均已精确清理。四端口即时复核为空；其后另一并行任务重新占用 55432，不属于本轮残留。

## 主要修复

- 修复 Socket.IO connected 与异步鉴权完成之间的首个房间加入竞态，并补真实事件因果和 StrictMode 连接回归。
- 让 Assist 更新遵守 content-tree 并发令牌，避免覆盖同步写入。
- 修复 Markdown 同目录 canonical path 解析、PostgreSQL pgvector 安全 fixture 的连接池 session 漂移和 full-suite 高负载下的进程超时测试窗口。
- 补齐协作/内容树数据库原子性、跨进程测试锁、数据库 fail-closed 和跨平台包管理器 launcher 等发布门禁。

## 验收边界

- Mac 本机范围 PASS；无已知值得继续修复的 bug。
- Windows 11 x64 same-code native 验证仍需执行；Mac 上两个 Windows-only skip 不能替代该验收。
- Assist 真实成功需要 OpenRouter API key；当前仅证明任务入队/worker 处理，外部调用因缺 key 失败，付费 fallback 未启用。
- 未 push、未发布 npm、未部署生产。
