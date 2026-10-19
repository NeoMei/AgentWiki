# 浏览器测试副作用与验收结论更正

日期：2026-10-18。修复基线：1812d6b1。触发：用户指出大量不可访问的空页面，与此前“浏览器验收通过”的报告不符。

## 发现

CUA 实际读取 Chrome 标签页 2011631421：URL 为 `https://wiki.test/onboard/device?user_code=E2E-CODE`，页面显示“无法访问此网站 / ERR_CONNECTION_CLOSED”。保存 `browser-test-leak.png` 后关闭该测试错误页，随后标签页列表中没有 wiki.test 页面。没有关闭其他用户页面。

`onboarding-e2e-driver.ts` 用模拟 device start 返回上述 URL，但未提供 `openBrowser`，因此 runtime 回退到真实 `openAuthorizationBrowser`，执行 macOS `open`。随后 mock `pollUntilSettled` 直接返回 authorized；页面是否可访问未进入测试断言。该 driver 的10个用例每轮可能打开10个页面，根测试还会嵌套运行该套件。这里是静态调用次数，不是对用户历史标签页数量的统计。

先前 runtime.spec 隔离修复没有覆盖此 driver，审查遗漏。系统打开命令成功、模拟授权成功、某些本地页面可渲染都不能支持完整接入验收通过。相关 acceptance、browser-qa、review 和任务记录已显式更正。

## 修复

- driver 显式注入只记录 URL 的 opener，返回 false，不调用系统浏览器。
- driver spec mock 生产 opener，并在每个用例结束时断言它从未被调用。即使以后再次遗漏注入，测试也会安全失败，不会实际开窗；五客户端用例还断言收到一次正确 URL 及 browserOpened=false。
- CLI 子进程测试用临时 CJS preload 在 Node execFile 边界拦截 open、xdg-open、rundll32.exe，避免此前 POSIX PATH stub 遗漏 Windows。该隔离只在测试子进程注入，没有新增生产环境开关。
- 子进程测试检查首次请求、status 和整个流程结束的浏览器请求计数，确保不会重复打开。

## 验证

- 修复前先增加真实 opener 零调用断言，10/10 安全失败：每例均捕获一次 E2E-CODE URL，未执行系统打开。
- 补上 driver 注入后，同一10项通过。
- Local Sync 完整复测：74 files，1071 passed / 1既有skip，exit0，41.75s。命令 `pnpm --filter @neomei/agentwiki-local-sync exec vitest run --maxWorkers=2 --testTimeout=20000`，原始日志 `browser-isolation-local-sync.log`。
- 根接入测试入口 `node --test scripts/onboarding-e2e.test.mjs`：8 passed / 0 failed，exit0，含嵌套driver测试，日志 `browser-isolation-root.log`。
- CUA 在清理错误页后及两轮修复验证后比较标签页：前后均8个、无新增、无wiki.test。脱敏回执 `browser-isolation-retest.json` 只记录数量、差异和测试页ID，不保存用户其他页面URL。
- 独立复核driver的hoisted mock和afterEach断言通过；子进程preload纯VM检查两种路径语义×三种opener共6组合，原生浏览器调用为零。Windows实际桌面仍未运行。
- 修改文件 `git diff --check` 通过。

## 未完成的验收

真实 WorkBuddy 中的新版本安装、真实授权页面加载及用户授权、客户端权限允许、重载/重启、通过宿主 MCP 读取已知页面尚未完成。先前截图仅保留其本地只读 fixture 与页面显示范围，不升级为真实授权证据。Windows/Linux 实机桌面未运行，本次跨平台拦截器不等于这些系统的端到端验收。尚未发布 npm 或部署生产。
