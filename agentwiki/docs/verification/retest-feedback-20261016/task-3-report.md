# Task 3 — 图谱删除关系可发现性（#13）

状态：本地候选已实现并由主代理提交为 `f0abd207`，定向自动验证通过；主代理已提供真实 Chrome 验收回执。全量发现的两处既有测试准备时序已作最小修正，修后客户端全量 159 files / 2657 passed，等待独立复审。本任务未推送、未发布，未操作真实业务数据。

## 根因

- `KnowledgeGraph.tsx` 将每条关系的方向、类型、来源以及 `Trash2` 删除按钮全部放在默认关闭的 `details.graph-relation-evidence` 中。按钮只有 14px 图标和 `title`，选中页面后无法直接发现。
- 删除 API 失败调用全局 `setError`，组件提前返回全页错误视图，导致选中页面、关系列表和证据全部不可见。
- 现有图谱 UI 未根据来源划分“可删除 / 不可删除”，删除授权由现有 API 决定。本次遵循任务简报，不增加自动关系禁止删除的政策。

## 修改

- 关联页面下改为常显的逐条关系列表。每条默认显示方向箭头、关系类型、来源徽标和“删除关系 / Delete relation”文字按钮。
- 按钮可访问名称包含真实源页面 → 目标页面、关系类型和来源，以区分同一页面对的正向、反向及多条关系。
- 每条关系的额外来源、置信度、生成者、审批和证据仍可按需展开；原始信息保留。
- 继续使用现有 `window.confirm` 和 `/knowledge/relations/{relationId}`。取消不发送删除请求；确认仅删除选定关系，不删除页面，不按页面对批量删除。
- 删除 API 的 403 / 网络错误在对应关系下显示本地化错误，保留原页面、关系与证据，可继续检查或重试；切换空间清除此状态，旧空间回执沿用现有隔离保护。
- CSS 沿用现有图谱视觉样式，关系类型允许换行；文字按钮使用独立一行，32px 最小高度，不要求为窄侧栏压缩文字。

## 验证

工作目录：`/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki /agentwiki`（`AgentWiki ` 有尾空格）。

先建立失败回归，再修改生产实现：

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/KnowledgeGraph.grouped.spec.tsx -t 'keeps every relation deletion|confirms and deletes only|retains the selected page' --reporter=dot
```

RED：exit 1，5 failed / 13 skipped。

- 中、英文各 1 项：`expect(element).toBeVisible()` 失败，旧删除按钮不可见。
- 反向关系 1 项：找不到含真实方向与类型的可访问删除按钮。
- 403 和网络错误各 1 项：失败后找不到“页面详情”侧栏。
- 原始日志：`/tmp/agentwiki-task3-red.log`。

实现后执行：

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/KnowledgeGraph.grouped.spec.tsx src/features/knowledge/KnowledgeGraph.spec.tsx --reporter=dot
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client exec eslint src/features/knowledge/KnowledgeGraph.tsx src/features/knowledge/KnowledgeGraph.grouped.spec.tsx src/i18n/bug-graph-messages.ts
git --work-tree='/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki ' diff --check
```

GREEN：2 test files，43 passed，exit 0；TypeScript、定向 ESLint、diff check 均 exit 0。GREEN 原始日志：`/tmp/agentwiki-task3-green.log`。

新回归验证中英文默认可见、自动来源保持原操作资格、正反向多关系区分、取消无写入、确认只删除指定 ID、删除后页面及其他关系保留，以及 403 / 网络拒绝保留上下文和可展开证据。原有图谱权限文案、分组、搜索、筛选、画布交互和跨空间相关测试一并通过。

## 浏览器交接与边界

- 复用主代理管理的 Vite 5197：`http://127.0.0.1:5197/e2e/fixtures/graph-reference.html`。
- 该入口为真实 `KnowledgeGraph` 组件与内存 Axios 数据，操作不影响生产。
- 选择节点后检查常显的删除文字按钮、方向 / 类型 / 来源、证据展开和取消 / 确认；切换 Language 检查英文，桌面及 390px 分别检查侧栏换行和横向溢出。
- 真实 Chrome 由主代理验收：英文删除单条关系后 4 → 3、38 个页面不变；中英 390px 的 `scrollWidth` 均为 390，文字删除按钮常显、证据保持折叠。主代理提供截图 `/tmp/agentwiki-retest-graph-390-zh.png`。这些是主代理回执，不是本子代理的 jsdom 断言。
- 本次处理的是删除 API 拒绝后的上下文保留。成功删除后的图谱重新获取仍沿用既有加载流程；刷新请求失败属于既有图谱加载错误处理，未在本任务中扩大修改。

## 全量测试时序追查与最小修正

主代理首次 `pnpm test:full` 的客户端阶段出现 2 failed / 2655 passed（`/tmp/agentwiki-retest-full-tests.log`）：

- 拖动后实际坐标 `[790, 178]`，预期 `[800, 178]`。
- 点击“适应图谱”后仍为 65%，预期小于 25%。

原两处测试、`useGraphViewport.ts` 和 `graphFolderLayout.ts` 在 `35f73159` 基线已有。两处测试只等待 API 数据产生的 `<option>`，便立即执行 reset/drag 或 fit；`graphNodes` 由后续 effect 派生，节点投影后的初始 `fitReadable` 仍可覆盖测试刚发起的操作。单独运行 18 项通过不能排除此时序问题。

对照过程没有回退共享工作树：用 `git archive 35f73159` 在 `/tmp/agentwiki-graph-baseline-4bpwjd` 创建客户端隔离副本，复用已安装依赖。基线全 client 运行实际复现相同拖动失败（原测试第 134 行，`[790, 178]` vs `[800, 178]`），见 `/tmp/agentwiki-task3-baseline-full-client-complete.log:52`。该副本同时有两个协作测试模块因临时副本缺 server package 依赖而无法加载；不把它记作完整基线通过。Fit 的相同失败在修改前候选的第二次全 client 运行再次出现（2656 passed / 1 failed），见 `/tmp/agentwiki-task3-candidate-repro-full-client.log`。

修正仅限测试准备条件：

- 拖动用例等待实际“小明 pages/项目/人物/小明.md”节点按钮出现。
- Fit 用例等待实际“Page 17 pages/Page 17.md”节点按钮出现。
- 所有原有坐标、初始可读比例、Fit 小于 25%、文件夹边界等断言均保留；没有固定 sleep、重试整个测试、放宽阈值或修改产品行为。

修后在与基线全量运行同时进行的负载下：

```sh
pnpm --filter @agentwiki/client exec vitest run --reporter=dot
# 159 test files passed; 2657 tests passed; exit 0

pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/KnowledgeGraph.grouped.spec.tsx src/features/knowledge/KnowledgeGraph.spec.tsx --reporter=dot
# 2 test files passed; 43 tests passed; exit 0
```

日志：`/tmp/agentwiki-task3-wait-fixed-full-client.log`、`/tmp/agentwiki-task3-wait-fixed-targeted.log`。全仓库 server / protocol / sync / DB 门禁由主代理继续记录，不能用客户端全量代替全仓库 `test:full` 成功。

## 完整文件列表

1. `apps/client/src/features/knowledge/KnowledgeGraph.tsx`
2. `apps/client/src/features/knowledge/KnowledgeGraph.css`
3. `apps/client/src/features/knowledge/KnowledgeGraph.grouped.spec.tsx`
4. `apps/client/src/i18n/bug-graph-messages.ts`
5. `docs/verification/retest-feedback-20261016/task-3-report.md`

未修改 GraphPage、服务端权限、fixture、其他任务实现或公共进度文件。
