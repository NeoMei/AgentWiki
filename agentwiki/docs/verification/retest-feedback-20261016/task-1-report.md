# Task 1 — #2 / #17 协作模板与必填校验

状态：独立审查 P1 已修正，受影响服务端定向验证通过；等待独立复审，尚未发布。

## 独立审查修正：合法 `collaboration: null` 来源识别

初次候选 `72a3a470` 的新分支仅接受 `definition.collaboration === undefined`，但当前 `CompositeTemplateDefinitionSchema` 要求该字段为对象或 `null`；普通单页的真实合法值是 `null`，生成器通过 `??` 走默认流程。初次服务端测试用不完整、未通过 schema 的 mock 省略了此字段，遗漏了实际路径；原 129 项绿色日志和模拟 DTO 浏览器验收不能证明此路径已修复。独立审查报告 `task-1-review.md` 的 P1 成立。

本次先以 `CompositeTemplateDefinitionSchema.parse()` 得到完整单页定义（包括 schemaVersion、page 元数据、双语内容和 `collaboration: null`），覆盖 personal/space × running/completed。修复前四项全部返回 `systemTemplateSource: null` 而失败；随后只改来源分支为接受 `null` 或历史缺字段 `undefined`。显式自定义 workflow 和页面组也换成经过 schema 校验的 fixture；显式 workflow 即使使用与默认流程完全相同的英文文字仍返回 null。另保留历史缺字段兼容用例。

最新验证（未执行 build，未改 dist；未碰其他任务）：
- `task-1-null-provenance-red.log`：**4 failed / 78 passed，82 total**，四个失败均为合法 null 定义来源仍为 null。
- `task-1-null-provenance-green.log`：5 suites，**132 passed / 0 failed**，含运行、输入、展开、实例化与已有运行编排。
- `task-1-null-provenance-typecheck.log`：服务端 `tsc --noEmit --incremental false` 退出 0。
- `task-1-null-provenance-lint.log`：两处变更文件 eslint 退出 0。

红回归实际命令：`pnpm --filter @agentwiki/server test -- src/collaboration-workflows/run.service.spec.ts --testNamePattern='schema-valid generated'`（项目 test 脚本的 `--` 使本次运行了整个测试文件，共 82 项）。绿回归使用下文列出的 5 个服务端 suites；类型命令不变；lint 本轮仅检查 `run.service.ts` 和 `run.service.spec.ts`。

原始 `.log` 文件受仓库 `.gitignore` 规则忽略，保留本地供审查；scoped commit 包含两处服务端变更和本报告，不强制纳入日志。

本次修正仅改变上述两个服务端文件；浏览器 fixture 仍测试相同的客户端 DTO 展示约定，无需改动。独立复审由主任务调度，修正证据不替代该复审。

## 根因

1. **#2 个人单页运行英文**：`template-instantiation.service.ts` 的 `ordinarySinglePageCollaboration()` 对没有显式 `collaboration` 的单页模板调用 `createSinglePageWorkflow('writer')`，个人、Space 和系统模板都会生成同一组系统任务/目标/Todo。`RunService` 原先只从模板当前的 `scope / stableKey` 判断系统翻译来源，个人模板因此返回 `systemTemplateSource: null`，客户端按保留用户文字的规则显示英文。
2. **#17 输入错误不一致**：`RunStartWizard` 只给运行名称提供行内错误与聚焦；模板必填项在循环内遇到第一项空值便发 toast 返回，且只判断 `undefined / ''`。服务端 `inspectCollaborationInputs` 只将 `undefined` 视为缺少必填项，空字符串和纯空白均能通过文本类型检查。运行名称服务端直接 `.trim()` 存储，没有拦截 trim 后为空。
3. 补充发现：schema 允许数字 input key；直接用 `Object.keys(errors)[0]` 获取首错误会按 JS 数字键顺序重排，导致聚焦到视觉上后面的字段。已用先失败的中英文用例验证，再改为按模板字段顺序查找。

## 修复

- 人类运行 DTO 读取运行引用的不可变 `compositeTemplateVersion.definition`。仅当 `sourceKind=composite`、定义为单页、只有一个 page 节点、collaboration 为 null（或历史缺字段 undefined）时，标记默认生成的 `single-page` 来源。现有系统模板和 page-selection 路径保留。
- 旧运行、已完成运行直接从其冻结版本获得来源，不改数据库内容，不补造历史，不按文字相等猜模板来源；冻结版本缺失/未知、自定义显式 workflow、页面组继续保留原文。此字段只作展示来源，不参与权限。
- 名称和所有模板必填项一次显示行内错误，设置 `aria-invalid / aria-describedby`，错误绑定 `role=alert`，按表单顺序聚焦首个错误。字段修改只清除本字段错误；切换路由或新运行时清空错误状态。
- required 文本空值、半角/全角空格、制表符和换行无效。数字 `0` 有效；必填复选框未勾选明确提交 `false`，不要求先勾选再取消；可选未填字段保持省略。
- 服务端统一输入解析拦截空/纯空白必填字符串，保留合法用户文字前后空白、可选文本、`0 / false` 和 schema 类型约束。运行名称在 create/update/page-selection/composite expansion 入口均通过同一非空解析后使用；权限检查没有放宽。
- 新行内错误文案仅加在 collaboration 的 `runStartText.ts` 中，简中/英文齐全，沿用既有错误样式和组件体系。

## 失败到通过证据

- `task-1-server-red.log`：2 suites，**8 failed / 75 passed**。失败精确包含必填空字符串/纯空白、运行名称空白、个人默认单页 running/completed 的 provenance。
- `task-1-client-red.log`：1 file，**3 failed / 87 passed**。失败为中英文多字段行内错误/聚焦缺失，以及 required unchecked boolean 无法作为 false 提交。
- `task-1-focus-order-red.log`：新增数字 key 的 UI 顺序检查，**2 failed / 88 skipped**，确认纯对象键排序会抢焦点。
- `task-1-client-green.log`：4 files，**164 passed / 0 failed**。
- `task-1-server-green.log`：5 suites，**129 passed / 0 failed**。
- `task-1-client-typecheck.log` / `task-1-server-typecheck.log` / `task-1-lint.log`：命令退出 0；无类型或 lint 错误。

覆盖：个人默认单页中英 × running/completed；系统模板既有路径；显式自定义 workflow、用户自定义任务/目标、Agent 名称保留；多个必填项、纯空白、空数字、合法 `0 / false`、可选字段、首错误顺序、更新/创建校验、页面模板实例化与既有运行编排调用链。

## 验证命令

工作目录均为 `/Users/neomei/.codex/worktrees/retest-feedback-20261016/AgentWiki /agentwiki`（`AgentWiki ` 尾空格保留）。

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/RunStartWizard.test.tsx src/features/collaboration/systemTemplateText.spec.ts src/features/collaboration/components/TaskPanel.spec.tsx src/features/collaboration/RunDashboard.test.tsx
pnpm --filter @agentwiki/server test -- src/collaboration-workflows/run.service.spec.ts src/collaboration-workflows/run-input-validation.spec.ts src/collaboration-workflows/run-expansion.service.spec.ts src/page-templates/template-instantiation.service.spec.ts src/page-templates/existing-run-orchestration.service.spec.ts
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/server typecheck
pnpm exec eslint apps/client/src/features/collaboration/RunStartWizard.tsx apps/client/src/features/collaboration/RunStartWizard.test.tsx apps/client/src/features/collaboration/components/TaskPanel.spec.tsx apps/client/src/features/collaboration/runStartText.ts apps/server/src/collaboration-workflows/run.service.ts apps/server/src/collaboration-workflows/run.service.spec.ts apps/server/src/collaboration-workflows/run-expansion.service.ts apps/server/src/collaboration-workflows/run-input-validation.ts apps/server/src/collaboration-workflows/run-input-validation.spec.ts apps/client/e2e/fixtures/collaboration-retest.tsx
```

## 浏览器 fixture 与验收交接

已提供并启动真实 `RunStartWizard` + `TaskPanel` fixture（Axios adapter 拦截所有 API，未匹配请求直接失败，无真实业务写入）。状态 **READY**，本代理停止修改 fixture 以避免 HMR 干扰主任务操作。

- URL：`http://127.0.0.1:5197/e2e/fixtures/collaboration-retest.html`
- 英文：同 URL 加 `?lang=en`；顶部也能切换语言。
- 启动：`pnpm --filter @agentwiki/client exec vite --host 127.0.0.1 --port 5197 --strictPort`
- 本次 Vite exec session：`23546`，保留给主任务验收。
- 表单必填：运行名称、`工作说明 / Work brief`、`范围 / Scope`（数字 key `2`）、`数量 / Count`、`启用 / Enabled`；`备注 / Note` 可选。
- 全空提交应有名称+说明+范围+数量共 4 个行内错误，首先聚焦名称；补名称后再次提交首先聚焦说明，不能因 scope 的数字 key 抢焦点。
- 说明填纯空白仍失败；填合法说明/范围，数量 `0`，启用保持未勾选、备注不填，下一页成功。下方 `Submitted draft` 回显实际模拟 POST，须含 `count: 0 / enabled: false` 并省略 note，保留用户输入的正文空白。
- 下方真实 TaskPanel 可切换“历史运行”和“自定义工作流”。默认生成流程中文为“编写页面 / 生成目标页面的完整 Markdown 内容 / 编写目标页面”；英文恢复相应英文。自定义 workflow 的 `systemTemplateSource=null` 时保持原始英文，用户文字和 Agent `Write Page / opencode` 始终保留。
- 建议 1365px 与 390px 各测中英，无横向溢出，检查错误布局、焦点和提交 payload。
- 主任务真实 Chrome 验收回执：全空 4 条行内错误、aria、名称聚焦通过；纯空白说明/范围均行内报错，首焦点说明；合法填写后的实际 adapter POST 为 `{"2":"当前文档","brief":"工作说明验证","count":0,"enabled":false}`。390px 下 `scrollWidth=390` 无横向溢出，英文全空 4 条英文行内错误；切中文和历史运行仍显示“编写页面”，原 Agent 名称和自定义文本保留。截图由主任务生成于 `/tmp/agentwiki-retest-collaboration-390.png`，复制为本目录 `task-1-browser-390.png` 留存。本回执明确为隔离 fixture Chrome 验收，不是生产或原 Windows 环境验收。
- 本代理曾尝试 standalone Playwright headless 启动；本机缺匹配 bundled Chromium，启动前停止，未执行页面操作。得知主任务已接管真实 Chrome 后删除临时 smoke 脚本，未安装浏览器或重复验收。

## 完整变更文件清单（本任务）

实现/测试：
1. `apps/client/src/features/collaboration/RunStartWizard.tsx`
2. `apps/client/src/features/collaboration/RunStartWizard.test.tsx`
3. `apps/client/src/features/collaboration/components/TaskPanel.spec.tsx`
4. `apps/client/src/features/collaboration/runStartText.ts`
5. `apps/server/src/collaboration-workflows/run.service.ts`
6. `apps/server/src/collaboration-workflows/run.service.spec.ts`
7. `apps/server/src/collaboration-workflows/run-input-validation.ts`
8. `apps/server/src/collaboration-workflows/run-input-validation.spec.ts`（新）
9. `apps/server/src/collaboration-workflows/run-expansion.service.ts`

验收 fixture：
10. `apps/client/e2e/fixtures/collaboration-retest.html`（新）
11. `apps/client/e2e/fixtures/collaboration-retest.tsx`（新）

报告/日志（本目录）：
- `task-1-report.md`
- `task-1-server-red.log`
- `task-1-client-red.log`
- `task-1-focus-order-red.log`
- `task-1-server-green.log`
- `task-1-client-green.log`
- `task-1-client-typecheck.log`
- `task-1-server-typecheck.log`
- `task-1-lint.log`
- `task-1-null-provenance-red.log`
- `task-1-null-provenance-green.log`
- `task-1-null-provenance-typecheck.log`
- `task-1-null-provenance-lint.log`
- `task-1-browser-390.png`（主任务真实 Chrome 截图副本）

## 边界

初次实现已由主任务提交，本次 P1 修正另作 scoped commit；未发布、未部署；未读取凭据、未改权限、未运行真实业务数据库写入。浏览器 fixture 的模拟 DTO 不能单独证明生产 DTO，后者由服务端 provenance 回归覆盖；整体发布及原 Windows/用户环境关闭仍需主任务的实际回执。没有冻结来源的未知旧数据继续保留原文，避免误翻译用户工作流。
