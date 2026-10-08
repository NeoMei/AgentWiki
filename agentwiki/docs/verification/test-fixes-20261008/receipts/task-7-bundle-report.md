# Task 7 构建预算补修回执

## 候选与范围

- BASE：`167237a1d70b36a9dfb05a97438717a01b714201`
- 产品候选：`d6c3934a609590ffbc1cf0e27f7c650ed5113f9c`
- 提交：`fix(client): keep system template lookup out of initial bundle`
- 工作树：`/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `（尾空格）；分支 `codex/test-fixes-20261008`。
- 本任务只修改 4 个产品/测试文件；未改预算、Vite 配置、依赖、可信系统来源判断、存储文本或语言 API。未写 `docs/verification` 或项目记忆。

## 根因与 RED

按 systematic-debugging 先诊断，再修改。生产构建的现有预算门禁即本问题的 RED：首屏 `553177 > 550000`，超过 `3177 bytes`。原 root 日志 `/tmp/agentwiki-1008-final-build.log`（root 另保留 `/tmp/agentwiki-1008-bundle-budget-failure.log`）。本任务原样复现记录 `/tmp/agentwiki-1008-bundle-current.log`。

临时脚本 `/tmp/agentwiki-1008-bundle-diagnose.mjs` 使用未修改的 Vite 配置，在原预算钩子之前以同样的入口/静态 imports 闭包记录产物；不关闭门禁、不写产物。对照实验仅在内存替换两个 i18n 文件为 `d78c4af9803068216486258f2c4fcc971c38c766` 的内容，所有其它文件保持 BASE，首屏为 `549099 bytes` 并通过预算。两文件的新增双语文案导致 `4078 bytes` 增量，足以解释本次跨限，不是猜测 Sources/Runs 新静态导入。

静态路径为 `App -> LanguageProvider -> messages -> system-collaboration-messages`。最后一个模块同时定义翻译值和仅协作运行页需要的原文→翻译 key 映射，使该 lookup 一起进入首屏；新增审核标准文本放大了既有边界问题。所有生产 lookup 消费者只有 TaskPanel / ReviewPanel / ArtifactPanel，经 `systemTemplateText` 由 `App` 的 lazy RunDashboard 进入。

诊断 JSON：

- `/tmp/agentwiki-1008-bundle-current.json`
- `/tmp/agentwiki-1008-bundle-baseline-i18n.json`
- `/tmp/agentwiki-1008-bundle-fixed.json`

## 最小修复

- `src/i18n/system-collaboration-keys.ts`：迁移完整原文 lookup，含 Todo/Review key 计算；不反向 re-export 到首屏 messages 模块。
- `src/i18n/system-collaboration-messages.ts`：保留完整双语翻译，导出既有只读 tuple 供 lookup 复用，移走 lookup。
- `src/features/collaboration/systemTemplateText.ts`：只改 lookup import，所有来源判定和字符串转换行为保持不变。
- `e2e/collaboration-system-layout.spec.ts`：在真实加载后的运行页增加中文→英文→中文交互，核验系统任务/Todo/审核文案与原样 Agent 名称。

一次性精确等价校验（`/tmp/agentwiki-1008-bundle-map-parity.cjs`）分别编译并比较 BASE 与当前模块导出，`225` 个 lookup 条目与英文 `229`、中文 `229` 条翻译序列化完全一致。日志 `/tmp/agentwiki-1008-bundle-map-parity.log`。

## GREEN 与字节变化

| 产物/门禁 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 首屏静态闭包 UTF-8 bytes | 553177 | 542577 |
| 入口 index chunk bytes | 312621 | 302021 |
| 首屏 system-collaboration-messages renderedLength | 32769 | 22285 |
| lookup 归属 | 首屏 index | 非首屏 RunDashboard |

- 首屏减少 `10600 bytes`，距上限余 `7423 bytes`。
- 新 lookup 位于 `assets/RunDashboard-PMHBXx4z.js`：chunk `48961 bytes`，lookup `renderedLength=10483`，`initial=false`。
- 入口为 `assets/index-RwTQtjfg.js`；其静态 imports 仍只有 React vendor、preload helper 与 CommonJS helper。
- `INITIAL_BUDGET=550000`、单 chunk `500000`、完整 Mermaid parser 例外上限 `720000` 及 CodeMirror/KaTeX/Mermaid 不得首屏加载约束均未改；全部通过。原有 Mermaid circular-chunk / parser size 提示仍保留。

验证命令与结果（均在明确的工作树执行）：

1. `pnpm --dir agentwiki --filter client build`：PASS，`542577/550000`，1 个既有 lazy parser exception；日志 `/tmp/agentwiki-1008-bundle-green-build.log`。
2. `pnpm --dir agentwiki --filter client exec vitest run src/features/collaboration/systemTemplateText.spec.ts src/features/collaboration/RunDashboard.test.tsx src/features/collaboration/components/TaskPanel.spec.tsx src/features/collaboration/components/ReviewPanel.spec.tsx src/features/collaboration/components/ArtifactPanel.spec.tsx src/context/LanguageContext.spec.tsx build/bundleBudget.spec.ts`：实际命中 6 文件、84 项 PASS；`LanguageContext.spec.tsx` 不存在，未作为覆盖计数。日志 `/tmp/agentwiki-1008-bundle-focused.log`。
3. `pnpm --dir agentwiki --filter client test`：141 文件、2234 项 PASS，无跳过；日志 `/tmp/agentwiki-1008-bundle-client-tests.log`。
4. `pnpm --dir agentwiki --filter client exec tsc --noEmit`：PASS；日志 `/tmp/agentwiki-1008-bundle-typecheck.log`。
5. `pnpm --dir agentwiki --filter client lint`：PASS，0 warning；日志 `/tmp/agentwiki-1008-bundle-lint.log`。
6. `git --work-tree='<上述精确路径>' diff --check`：PASS。

## 生产构建 Chrome 交互验收

使用实际 `dist` 的 Vite preview：`http://127.0.0.1:5197`，可选代理指向本地 API 3191；以下协作/来源 E2E **所有 API 响应和写操作都由浏览器内 fixture 拦截**。这是生产打包产物及真实 Chrome 的界面验收，不是真实后端权限/授权矩阵，不外推为生产环境、真实 Agent 或原报告全部闭环。

- `AGENTWIKI_WEB_URL=http://127.0.0.1:5197 pnpm --dir agentwiki --filter client exec playwright test e2e/collaboration-system-layout.spec.ts e2e/source-runs-navigation.spec.ts --output=/tmp/agentwiki-1008-bundle-preview-artifacts`：两个旧运行深链分别 PASS；协作测试初次新增英文 Agent 标签期望误写为 `Frozen assignee for this Run`，实际既有文案为 `Frozen assignee`，因此测试失败。此失败只属于新增测试期望错误，未当作产品 RED，原日志和 trace 保留。
- 修正该测试期望后，仅重跑改变的协作测试：`AGENTWIKI_WEB_URL=http://127.0.0.1:5197 pnpm --dir agentwiki --filter client exec playwright test e2e/collaboration-system-layout.spec.ts --output=/tmp/agentwiki-1008-bundle-preview-green-artifacts`：1/1 PASS。
- 协作运行页 `/spaces/space-layout/collaboration/runs/run-system-layout`：1912/1280/390 宽度布局、中文系统名称/目标/Todo/审核条件、原样 Agent 名、pending 卡片动作、冲突安全动作保持；切换英文得到 `World bible`、`1. Define world rules`、`Evidence is complete`，再切回中文成功。
- 旧深链 `/spaces/task5/runs?run=failed-run` 与 `/spaces/task5/runs/failed-run`：均重定向来源运行 tab，详情可见，fixture 重试/取消请求正确，来源/运行切换正常，390px 无横向溢出。
- 首页独立真实 Chrome 脚本 `/tmp/agentwiki-1008-bundle-home-smoke.mjs`：实际标题中文→英文正常，网络只加载 `/assets/...` 的 4 个首屏脚本，没有 `@vite/client` 或 RunDashboard chunk，页面错误 0。

日志/截图：

- `/tmp/agentwiki-1008-bundle-preview-tests.log`（首跑含上述 2 PASS / 测试期望失败）
- `/tmp/agentwiki-1008-bundle-preview-green-tests.log`（协作最终 1 PASS）
- `/tmp/agentwiki-1008-bundle-preview-green-artifacts/collaboration-system-layou-a3654-and-bounded-long-text-cards/system-layout-1280.png`（已实际打开检查）
- 同目录 `system-layout-1912.png`、`system-layout-390.png`、`pre-detected-conflict.png`、`geometry.json`
- `/tmp/agentwiki-1008-bundle-preview-artifacts/`（旧深链截图和首跑失败 trace）
- `/tmp/agentwiki-1008-bundle-home-smoke.json`、`/tmp/agentwiki-1008-bundle-home-smoke.log`、`/tmp/agentwiki-1008-bundle-home.png`

## 交接与未验边界

- 自建 preview 已结束（会话 exit 130），`lsof -nP -iTCP:5197 -sTCP:LISTEN` 无输出/exit 1；未停止 root 已有 5191/3191 服务。
- 未重跑数据库、后端、协议、本地同步或插件整套；该修复没有改这些范围，root 已有 BASE 回执并将做冻结 delta 复审和全仓 build。
- 本地候选、单任务验证和 Chrome fixture 界面已完成；正式独审、root 全仓 build 与最终记录由 root 接续。
- 未 push、merge、deploy、触碰生产、Vault 或凭据。报告完成后停止写入。
