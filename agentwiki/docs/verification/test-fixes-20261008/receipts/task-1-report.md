# Task 1 实现报告

状态：实现完成，focused 回归与 client typecheck 通过；等待 root 独立审查与最终浏览器验收。

- 工作树：`/Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki `（尾空格）
- Base：`022f5b95131ac45b08425d3f8d3a8aaa1cd50196`
- Commit：`f5f45b8a`，`fix(client): unify directory menus and localize loading errors`
- 本报告属于忽略的 `.superpowers/` 任务材料，已写入请求路径；产品提交没有强制加入该目录。

## 修改

1. `ContentTree.tsx` 与新 `TreeActionMenu.tsx`：移除每行原生 details 实现，使用共用受控菜单。全 Document 只允许一棵树的一行打开；pointerdown 点外、全局 Esc、动作触发、滚动与窗口缩放均关闭。Esc 与动作返回可见行触发按钮；模板保存传可见触发按钮给弹窗。保留 Enter/Space、Arrow/Home/End 导航以及 disabled 动作跳过。fixed 菜单根据最近目录滚动区域上下空间定位并限制高度，统一应用于左侧、右侧树。
2. `SpaceDirectory.tsx`：删除左侧专用互斥/定位/关闭逻辑与重复 `/search` 链接，保留现有顶栏搜索与本地过滤。通过可选 `highlightQuery` 将过滤词传入 ContentTree。
3. `ContentTree.tsx`：按字面匹配进行大小写不敏感 React 文本/mark 分段；不解析 HTML，不使用 dangerouslySetInnerHTML，不把过滤视为全空间搜索，不加载隐藏分支。
4. `useSpaceDirectory.ts`：保留原始请求错误，在渲染输出时调用实际签名 `apiErrorMessage(error, t, fallbackKey)`。403 显示中文/英文权限指导而非 Axios transport message；目录代次变化使用共享语言资源。失权仍清除目录，成功分支保留与分支重试行为不变。
5. `KnowledgeGraph.tsx`：加载、关系创建/删除错误均走 apiErrorMessage；保存原始 failure 与 fallback key，因此已显示错误会随共享语言切换重译，不因切换语言重请求。
6. `SpaceView.tsx`：空间标题布局去掉折叠目录 44px 宽度依赖；使用 min-w-0 与桌面最大宽度，长标题截断仍保留完整 title，移动端容器保持全宽。
7. `i18n/messages.ts`：新增目录加载/代次变更和图谱加载/关系操作 fallback，均有中英文本。
8. 修改相应五个 spec；额外验证 PageEditor/SpaceWorkspace 调用方 specs，未修改这两个调用方实现或 specs。

## TDD RED

所有命令在产品目录 `agentwiki/apps/client` 下执行，Node v24.18.0、pnpm 11.9.0；共享包和同步协议包沿用已构建基线。先新增测试，再观察真实失败后实现。

- `pnpm exec vitest run src/features/content-tree/ContentTree.spec.tsx -t 'shared directory menu regressions'` → 4 个真实失败：两行/跨树未互斥，pointerdown 不关闭，动作后不关闭，无 mark。证据 `/tmp/agentwiki-task1-menu-red.log`。
- `pnpm exec vitest run src/features/space-workspace/useSpaceDirectory.spec.tsx -t 'localizes'` → 1 个真实失败：中文期望权限指导，实际 `Request failed with status code 403`。证据 `/tmp/agentwiki-task1-error-red.log`。
- 初始五 spec focused 命令 `-t 'shared directory menu regressions|exposes the shared new-page|filters loaded items with ancestor|localizes|retains a readable'` 确认目录搜索冗余链接、过滤无高亮、图谱后端 Forbidden 与标题 44px 的真实失败；该初次 batch 的新增 hook 测试 callback 不稳定导致 worker 退出，已修正为稳定 callback，并用上面独立 hook RED 作为有效错误证据，不把 worker 退出计为产品失败。证据 `/tmp/agentwiki-task1-red.log`。
- `pnpm exec vitest run src/features/space-workspace/useSpaceDirectory.spec.tsx src/features/knowledge/KnowledgeGraph.spec.tsx -t 'language changes|switching language'` → 2 个真实失败：图谱错误不重译，目录译文切换会重发请求。证据 `/tmp/agentwiki-task1-language-red.log`。
- `pnpm exec vitest run src/features/knowledge/KnowledgeGraph.spec.tsx -t 'relation .*permission denial'` → 2 个真实失败：创建/删除关系权限错误均直接展示 Forbidden。证据 `/tmp/agentwiki-task1-graph-mutation-red.log`。
- 自审后补 `pnpm exec vitest run src/features/content-tree/ContentTree.spec.tsx -t 'opener element|visible row trigger'` → 2 个真实失败：传入隐藏菜单按钮，以及弹窗动作时 activeElement 仍为隐藏按钮。证据 `/tmp/agentwiki-task1-focus-red.log`。

## 最终 GREEN

```sh
pnpm exec vitest run src/features/content-tree/ContentTree.spec.tsx src/features/space-workspace/SpaceDirectory.spec.tsx src/features/space-workspace/useSpaceDirectory.spec.tsx src/features/knowledge/KnowledgeGraph.spec.tsx src/features/space/SpaceView.spec.tsx src/features/space-workspace/SpaceWorkspace.spec.tsx src/features/page/PageEditor.spec.tsx
pnpm exec tsc --noEmit
```

- 7 specs，262/262 PASS，exit 0；日志 `/tmp/agentwiki-task1-final-green.log`。
- client typecheck PASS，exit 0；日志 `/tmp/agentwiki-task1-typecheck.log`（成功空输出）。
- `git --work-tree=... diff --check` PASS；所有 git 操作同时指定准确 cwd 与显式尾空格 work-tree，未改 core.worktree。

## Self-review 与边界

- 菜单关闭/互斥放在 ContentTree 共用组件，左侧不再维护第二套逻辑；测试覆盖两棵独立 ContentTree、SpaceDirectory 左侧鼠标/键盘/滚动及右侧共用行为，动作只调用选中节点的对应 callback。
- 接口新增 highlightQuery 可选，现有调用方兼容；既有权限 canEdit、pageDeleteDisabled、mutation scope 和服务端授权逻辑保留。错误重译没有额外请求和授权扩大。
- 未增加组件库。使用原有灰/白/蓝交互风格，新增文本全部来自共享语言上下文或资源。
- 只执行本地 mock/fixture 单元回归，所有 API mock 只在测试内；未连接生产、修改远程状态、部署、推送、审批或自动保存文档。未清理外部环境资源。
- Rect mock 测试仅验证定位/关闭逻辑，折叠标题测试仅验证结构约束；不计为视觉或原生验收。真实几何遮挡下点击是否准确、桌面/小屏可读性与最终浏览器交互由 root 的本地 fixtures 最终验收补足，不能用此处 262 项通过替代该门禁。
- root 尚未完成独审，本实现报告不声称独审、集成或部署通过。


## Fix round 1：I1 几何遮挡修复回执

- FIX_BASE：`f5f45b8a3911c6818fa42b992b0fce340099f839`
- Fix commit / HEAD：`e039fb652fd0d5f53bbd6d922a5cb7d05010cce1`，`fix(client): keep directory action columns clear of open menus`
- 已完整读取 task-1-review.md；唯一 Important I1 经真实 Chrome 复现后修复。之前仅单元几何 GREEN 的证据不能满足该 finding。

### 最小实现

`TreeActionMenu.tsx` 不再将菜单右边与触发按钮右边对齐。优先放在触发按钮列左侧并留 4px 间距；左侧不足时选择右侧，必要时按可用水平空间收窄。菜单明确设置宽度，再读取真实尺寸确定位置：fixed 元素若只写 left，会在定位后重新按可用宽度变宽，仍可能重新覆盖触发列。原先上下展开、滚动高度限制、互斥、焦点和权限逻辑保留。

修改 `SpaceDirectory.spec.tsx` 的位置断言，验证菜单右边与触发列错开。新增可复跑 Chrome 回归 `e2e/content-tree-menu.spec.ts` 和 browser-only fixture `e2e/fixtures/content-tree-menu.html/.tsx`，无账号、服务器请求或真实动作。

### 真实浏览器 RED → GREEN

命令（cwd=`agentwiki/apps/client`）：

```sh
AGENTWIKI_WEB_URL=http://127.0.0.1:5191 pnpm exec playwright test e2e/content-tree-menu.spec.ts --workers=1
```

- 修改实现前，Chrome 1912px 与 390px 两个用例均真实 RED：第二行中心 `elementFromPoint` 不属于第二行触发按钮，`Expected true / Received false`。日志 `/tmp/agentwiki-task1-i1-browser-red.log`；首轮失败 trace 保留于 `/tmp/agentwiki-task1-i1-red-traces/`。
- 最终同一回归 2/2 PASS，exit 0，日志 `/tmp/agentwiki-task1-i1-browser-green.log`。两种视口均覆盖右侧 ContentTree；1912px 另覆盖左侧 SpaceDirectory，390px 另覆盖实际 ModalDialog 目录抽屉。打开第一行后验证该表面所有行触发按钮中心可达，再普通点击第二行，确认第二行打开/第一行关闭、只有一个菜单、action-log 始终为空。没有 force click 或 DOM click。菜单实际边界没有超出视口，Esc 返回第二行触发按钮。
- 本地真实应用回读：`node /tmp/agentwiki-task1-i1-app.cjs`，exit 0。仅使用 root 提供的本地 3191/5191 fixture，读取本地身份用于浏览器登录初始化，未打印或提交 fixture 内容。1912px 和390px 均第二行中心命中正确，普通点击后 firstClosed=true、secondOpen=true、unexpectedDialogs=0。日志 `/tmp/agentwiki-task1-i1-app-green.log`，截图 `/tmp/agentwiki-1008-ui/task1-i1-menu-1912.png` 与 `task1-i1-menu-390.png`；原始 `/tmp/agentwiki-1008-ui/menu-open.png` 未覆盖。
- Playwright 输出有环境级 NO_COLOR/FORCE_COLOR 相冲 warning，不影响回归；没有产品异常。

### 受影响 focused 验证

```sh
pnpm exec vitest run src/features/content-tree/ContentTree.spec.tsx src/features/space-workspace/SpaceDirectory.spec.tsx
pnpm exec tsc --noEmit
```

- ContentTree/SpaceDirectory 2 specs，45/45 PASS，exit 0，日志 `/tmp/agentwiki-task1-i1-focused-green.log`。
- client typecheck PASS，exit 0，日志 `/tmp/agentwiki-task1-i1-typecheck.log`（空）。
- diff --check PASS；fix commit 后工作树 clean。

### 自审与边界

- I1 使用真实中心 hit-test、无 force 的普通浏览器点击以及回调记录验证，未再用 fireEvent 或 Rect mock 代替安全命中验收。
- 只改菜单几何定位和相关回归，没有扩大权限、自动审批/保存、远程操作或生产连接；测试 fixture 没有身份数据，也不发 API 请求。本地真实应用回读未提交任何动作。
- 本回执只声称 I1 修复与所述 viewport/表面回归通过，其他任务与最终全产品验收由 root 完成，独审复查尚待回执。
