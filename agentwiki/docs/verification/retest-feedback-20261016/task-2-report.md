# Task 2：编辑态目录高亮（#12）

状态：实现与本地回归完成，等待独立审查及整分支原案验收；未提交、发布或部署。

基线：Web v0.12.44。工作树：`/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki `（末尾空格保留）。只修改本任务的编辑器实现、独立 fixture / E2E 和本报告。fixture 全部使用合成长文，不含原报告正文、账号或业务数据。

## 根因与修复

1. 点击使用 `EditorView.scrollIntoView(..., { y: 'start' })`，未指定时 CodeMirror 默认再留 `yMargin=5`；既有 `scrollMargins` 又把工具栏的屏幕坐标直接用作滚动容器内部的 margin。高亮监听却只用 `toolbar.bottom + 12` 的屏幕边界，两处坐标和间距不一致。
2. 原监听逐个调用 `coordsAtPos(heading.from)`。长文中前面的标题被 CodeMirror 虚拟化后返回 `null`；目标标题尚未越过阈值时，循环保留默认首标题。于是点击设置的正确高亮被后续 scroll 覆盖为上一标题或首标题。
3. CodeMirror 会在点击后展开折叠、显示 Markdown 源标记、后台解析和重新测量软折行。文末受滚动最大值限制，点击目标也未必能到达顶部边界，不能仅用一次选中状态或固定延时处理。

修复：

- 以真实可滚动祖先的可见顶部计算工具栏 margin，点击显式使用 `yMargin: 0`。
- 常规滚动通过 `lineBlockAtHeight(boundary - documentTop).from` 读取源位置，覆盖软折行、虚拟化和折叠，不再依赖每个标题的 DOM 可测性。
- 点击保留目标的实际坐标与内容 DOM 高度；只有位置未变或内容高度正在重新测量时维持这次目标。后续高度变化按实际布局再对齐。
- 重新对齐没有产生 scroll 事件时，也在下一帧记录实际坐标，防止 `top=null` 使首次外部滚动被误判为定位过程。
- 正文滚轮、触摸、指针、滚动键、选区改变、正文修改和窗口 resize 会清除点击锚点；没有输入手势的实际滚动也会在目标坐标变化时释放。目录面板自身滚动不进入正文高亮监听。没有永久锁高亮，也没有固定毫秒延时。

## 先失败、后通过

先新增真实 CodeMirror fixture 和浏览器测试，再修改生产代码。

失败命令（原实现）：

```sh
AGENTWIKI_WEB_URL=http://127.0.0.1:5188 pnpm --filter @agentwiki/client exec playwright test e2e/editor-outline.spec.ts --workers=1 --output=/tmp/agentwiki-toc-red
```

结果：**4 failed**。1440px / 390px 点击长文 Chapter 12、折叠后的 Final child 均在实际滚动完成后丢失 `aria-current="location"`。1440px 实测选区已到 Chapter 12 的正确源偏移 `47396`，目标 `top=152.140625`，工具栏 `bottom=98`；Chapter 0–11 的 `coordsAtPos` 全为 `null`。失败 trace / error-context 保留在 `/tmp/agentwiki-toc-red/`。

最终浏览器命令：

```sh
AGENTWIKI_WEB_URL=http://127.0.0.1:5188 pnpm --filter @agentwiki/client exec playwright test e2e/editor-outline.spec.ts --workers=1 --output=/tmp/agentwiki-toc-final-pass
```

结果：**4 passed，8.5s，exit 0**。Chrome `155.0.8059.40`，真实布局，1440×800 与 390×800；每个尺寸覆盖：

- 长文目录点击的正文源位置与当前高亮一致；目标在工具栏下方。
- 长段落软折行，滚入正文后仍为所在章节；向上人工滚动后转为上一章节。
- 同名标题按源偏移区分，选第二个时不会跳到第一个。
- 滚动目录面板不改正文高亮。
- 无滚轮 / 键盘手势，直接改变正文 `scrollTop` 仍更新到上一标题，证明没有永久锁定。
- 折叠父章节后点击末尾子标题会展开，文末无法顶端对齐时仍正确高亮。
- 随后的滚轮与 PageUp 会解除末标题高亮并按当前位置更新。
- 短文末标题点击正确；导航与人工滚动不修改原文。

开发中一次 Vite 热更新导致 `Execution context was destroyed`；未把该轮当成通过，最终上述完整运行 exit 0。

## 最终定向检查

全部命令在 `.../AgentWiki /agentwiki` 目录执行：

```sh
pnpm --filter @agentwiki/client exec vitest run src/components/MarkdownWorkspace.spec.tsx src/components/markdown-tools/outline.spec.ts src/features/space-workspace/ArticleContentsPopover.spec.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm exec eslint apps/client/src/components/MarkdownWorkspace.tsx apps/client/e2e/editor-outline.spec.ts apps/client/e2e/fixtures/editor-outline.tsx
git --work-tree='/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki ' diff --check -- agentwiki/apps/client/src/components/MarkdownWorkspace.tsx
```

- Vitest：**3 files / 151 tests passed**，4.05s，exit 0。
- TypeScript：exit 0。
- 定向 ESLint：exit 0，无警告或错误。
- diff whitespace 检查：exit 0。
- 全分支构建、全量测试与独立审查由主任务集成执行；以上不代表生产原案或 Windows 验收已关闭。

## 浏览器验收入口

启动：

```sh
pnpm --filter @agentwiki/client dev --port 5188 --strictPort
```

打开 `http://127.0.0.1:5188/e2e/fixtures/editor-outline.html`。交付时该 Vite 进程仍运行，exec session `77848`，供主任务继续验收。

1. 点击 Chapter 12，观察正文与高亮；在正文中向下、向上滚动。
2. 点击第二个 Repeated heading，确认源位置；滚动右侧目录，正文高亮不变。
3. 在隔离 fixture 控制台调用 `window.outlineFixture.fold()`，点击 Final child，确认展开与末标题高亮；再用滚轮 / PageUp。
4. 调用 `window.outlineFixture.short()`，点击 Short end；用 `window.outlineFixture.metrics()` 读选区、折叠数、工具栏和标题坐标。
5. 调成 390px 视口重做。原反馈页面的本地私有回放由主任务完成，不把原报告内容提交到 fixture。

## 完整变更文件

1. `apps/client/src/components/MarkdownWorkspace.tsx`
2. `apps/client/e2e/editor-outline.spec.ts`
3. `apps/client/e2e/fixtures/editor-outline.html`
4. `apps/client/e2e/fixtures/editor-outline.tsx`
5. `docs/verification/retest-feedback-20261016/task-2-report.md`
