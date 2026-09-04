# AgentWiki Windows 最终代码交接

日期：2026-09-04（Asia/Shanghai）

## 目标与代码身份

- Mac 最终验证代码提交：`e94fa7ba0b2a49f39a19be8405b582e213ec4c88`。
- 该提交在 Mac 工作树和全新 `--no-local` clean clone 中分别完成 4265 total / 4262 pass / 0 fail / 3 skip，以及 typecheck、lint、build和真实 CodeGraph；工作树的裸 `pnpm audit` 为零已知漏洞。
- 后续只允许证据/交接文档提交；Windows 开始前必须确认从 `e94fa7b` 到待测 HEAD 没有应用、包、脚本、锁文件或配置代码变化。若有任何非文档变化，必须重新确定候选 SHA。
- 此交接不表示代码已 push。当前 Mac 分支领先 `origin/master`，需由获授权的人先同步远端，Windows 再从相同远端取得候选。

## Windows 11 x64 必做验证

在全新 clone 中执行，并保留命令 exit code、完整测试计数、skip 原因和系统版本：

```powershell
git rev-parse HEAD
git status --short
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
pnpm test:full
pnpm typecheck
pnpm lint
pnpm build
pnpm audit
git diff --check
```

必须额外证明以下 Windows 原生边界：

1. 包管理器 launcher 能在 Windows 上正确解析 pnpm JS 入口，不依赖 PATHEXT 对无扩展 shim 的解析。
2. Prisma migration launcher 使用 `process.execPath` 且 timeout 有界；所有真实数据库 gate 不出现 `spawn pnpm ENOENT`、`.cmd` 被当成 JS 或无限等待。
3. OpenCode Windows 可执行文件实际启动与探测通过；不能用 macOS 的平台 skip 代替。
4. Windows ACL / junction / symlink 安全断言实跑通过；不能用 macOS 的平台 skip 代替。
5. Docker Desktop 提供隔离 PostgreSQL 16 + pgvector 和 Redis AOF；禁止迁移或清理共享 `public`，结束后必须证明测试 schema、临时数据库、进程、容器和端口无残留。
6. Chrome Playwright 以单 worker、`--retries=0` 跑最终 collection；记录 files/tests 数量、失败 artifacts 和 UI 桌面/390px 证据。

## 验收结论格式

- Windows native：PASS / FAIL / BLOCKED_ENVIRONMENT。
- 精确待测 SHA 与 `git status`。
- 完整测试、typecheck、lint、build、audit、Playwright 的 exit code 和计数。
- 三项 Mac skip 在 Windows 上的实际结果；若仍 skip，逐项说明依据并不得给全平台 PASS。
- 所有修复必须提交到独立 SHA，再把新 SHA 交回 Mac 重跑最终代码门禁；不得只写交接说明而不提交代码。

## 仍需独立授权的动作

GitHub push、npm publish 和生产部署都不在本交接授权范围内。Windows 验证通过不自动授权这些动作。
