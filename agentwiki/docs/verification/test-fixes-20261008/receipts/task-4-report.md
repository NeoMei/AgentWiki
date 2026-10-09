# Task4 实现报告

状态：实现及自验完成，候选待控制器独立审查。
分支：`codex/test-fixes-collaboration-20261008`
BASE：`f5f45b8a3911c6818fa42b992b0fce340099f839`
Commit：`a1c68a26`
工作树：`/Users/neomei/.codex/worktrees/test-fixes-collaboration-20261008/AgentWiki `（尾空格）

## 变更

- RunService 从真实 legacy/composite 模板存储关系投影 `systemTemplateSource: {slug} | null`；仅内置且系统所有权、spaceId=null的来源认可。历史组合 Run 的 templateId=null 不再影响翻译，无 schema 迁移。内部关系不暴露。
- 所有五个内置协作模板任务名、目标、Todo、审核标准及合成页面审核标准双语覆盖；用户 Run 名、Agent 名、自定义模板同名文本、审核正文/证据、代理产物名称保持原文。
- 服务器生成产物摘要使用 `previewFormat: kind_version` 显式标识，仅其类型名本地化（markdown/json/external_reference/evidence_summary）；用户名恰好等于 markdown v1 仍保持原文。
- pending Review 稳定排序前置，审批动作/比较加载入口置于 sticky 卡片头部；页面比较仍按需加载，未经 comparison.canDecide、缺基线或冲突时不批准。提交时再检查当前快照，防止打开对话框后权限撤回仍 POST。
- 三列使用 minmax(0,...)，右侧审核行获得更多空间；长文本按 anywhere 换行，桌面独立卡片滚动，手机自然文档流。

## TDD 与验证

依赖已安装。全部命令在独立 worktree/agentwiki 执行，日志见 `task-4-evidence/`。

RED：
- `pnpm --filter @agentwiki/client test src/features/collaboration/components/TaskPanel.spec.tsx src/features/collaboration/components/ReviewPanel.spec.tsx`：4 failed / 7 passed，组合运行翻译、排序/头部动作、缺基线 guard。
- `pnpm --filter @agentwiki/server test --testPathPatterns=run.service.spec.ts`：2 failed / 56 passed，来源 DTO absent。
- `pnpm --filter @agentwiki/client test src/features/collaboration/systemTemplateText.spec.ts src/features/collaboration/components/ArtifactPanel.spec.tsx`：6 failed，审核标准覆盖与合成产物名未译。
- `pnpm --filter @agentwiki/client test src/features/collaboration/RunDashboard.test.tsx`：1 failed / 49 passed，打开对话框后刷新撤回 canDecide 仍调用 decideReview。
- 产物同名来源/全部类型专用 RED 分别1 failed、2 failed。
- 极长无空格审核标准 Chrome RED（agentwiki-task4-red-layout-criteria.log）：卡片 clientWidth345，scrollWidth9091。修复审核卡片根节点换行后 GREEN。
- 为验证之前的 CSS 假设，临时回退部分 CSS 的试验通过（agentwiki-task4-red-layout.log）；它未复现原始缺陷，未作为 RED 证据。

GREEN：
- `pnpm --filter @agentwiki/client test src/features/collaboration`：15 files / 269 tests passed。
- `pnpm --filter @agentwiki/server test --testPathPatterns='collaboration-workflows/(run.service|run-page-comparison).spec.ts'`：2 suites / 68 tests passed。
- `pnpm --filter @agentwiki/client exec tsc --noEmit` / `pnpm --filter @agentwiki/server typecheck`：通过。
- client 协作目录/系统语言资源、server 两个修改文件 ESLint：通过；git diff --check通过。
- `AGENTWIKI_WEB_URL=http://127.0.0.1:5194 pnpm --filter @agentwiki/client exec playwright test e2e/collaboration-system-layout.spec.ts e2e/collaboration-reentry-layout.spec.ts`：实际 Chrome 2/2通过。fixture仅本地API，无生产操作；全部验证请求无POST。

## Chrome 截图与量化

已实际打开并检查三个宽度截图。产物名、审核标准及页面正文含超长无空格字符串。

| 宽度 | documentWidth | 审核/产物/活动 clientWidth=scrollWidth | 桌面右列 bottom |
|---|---|---|---|
|1912|1912|345=345|854，900px视口内|
|1280|1280|322=322|854，900px视口内|
|390|390|324=324|自然流，overflowY=visible|

桌面审核 header 内审批按钮初始与滚动120px后均在审核卡片可见矩形内。各卡片左右边框在视口内，scrollWidth≤clientWidth。旧 crowded reentry 用例含15任务/6审核/50事件，独立滚动与移动顺序仍通过。

- task-4-evidence/system-layout-1912.png
- task-4-evidence/system-layout-1280.png
- task-4-evidence/system-layout-390.png
- task-4-evidence/geometry.json

## 自审与边界

自审完成：未变更审批服务权限，未更改baseline/CAS/冲突恢复契约，来源仅可信DB关系；Run DTO大小预算继续生效；无生产迁移/数据操作，无新审批权限。新 DTO 显式 null 抑制旧模板回退误译。Task3不改RunService，但控制器整支仍须独审。

Concerns：浏览器是本地fixture，不能证明真实认证/provider/生产授权；当前 candidate 尚未集成/部署；系统来源新增 DTO 需要同版 server/client 集成，旧server的组合Run无来源仍保留原文。原需求单实际用户历史模板/权限场景需控制器后续集成回归。


## Fix round1 — 独审 P1 与 Minor

FIX_BASE：`a1c68a267fd8d7c3de22f7687f52fb88e7df35de`
新 Commit：`58c51186`（原独立 worktree / 同分支，候选等待重新独审）

修复内容：

- ReviewPanel分离 canDecide（实时Review能力 + comparison能力）和 canApprove（另要求无冲突、可用基线）。waiting_review + pauseReason=null + comparison.conflict=true 保留驳回返工、终止及两个恢复入口，禁止批准。
- RunDashboard提交复核仅对approve执行冲突/基线约束；安全返工/退出仍须当前Review与comparison双重授权。页面同eventSequence刷新canDecide=false使旧比较失效，且提交guard复核当前Review，撤权不POST。
- 现有恢复端点支持 waiting_review/null 预检测态；真人Space授权/指定审核人、待审Review与当前Task代次、来源Link及当前Page CAS继续生效。服务端额外检查Artifact真实冻结基线与当前页面确有冲突，阻止伪造无冲突恢复请求；先CAS/冲突确认，再在采纳时补建PageVersion。冲突approve仍禁用，没有通过approve触发暂停的绕路。

TDD：

- Client RED：`pnpm --filter @agentwiki/client test src/features/collaboration/components/ReviewPanel.spec.tsx src/features/collaboration/RunDashboard.test.tsx`，6 failed / 55 passed，分别是预检测冲突返工/终止/两种恢复不可达、同序列缓存撤权，以及ReviewPanel动作入口缺失。
- Server RED：`pnpm --filter @agentwiki/server test --testPathPatterns=page-result-conflict.spec.ts`，2 failed / 9 passed，待审核状态两种恢复被旧pauseReason限制拒绝。
- Client focused GREEN：61/61；全协作区 GREEN：15 files / 275 tests。
- Server focused GREEN：`pnpm --filter @agentwiki/server test --testPathPatterns='(page-result-conflict|review.service|run-page-comparison).spec.ts'`，5 suites / 148 tests；含预检测恢复、无冲突伪造拒绝、CAS过期、指定审核人拒绝及安全reject/terminate不publish回归。
- 双端typecheck、六个修改源文件/测试scoped ESLint、git diff --check：通过。
- Chrome GREEN：`env -u NO_COLOR -u FORCE_COLOR AGENTWIKI_WEB_URL=http://127.0.0.1:5194 pnpm --filter @agentwiki/client exec playwright test e2e/collaboration-system-layout.spec.ts e2e/collaboration-reentry-layout.spec.ts`，2/2。保留1912/1280/390布局量化，并增加真实DOM预检测冲突状态：无通过按钮、返工/终止可达、两种恢复入口可达；点击重新生成只POST现有 `/tasks/task/page-conflict`，没有approve请求。
- 新浏览器日志已清理NO_COLOR/FORCE_COLOR重复告警，见task-4-evidence/round1/agentwiki-task4-r1-browser.log。旧日志作为历史原件保留。

证据：`task-4-evidence/round1/` 包含全部RED/GREEN、typecheck/lint日志、三宽截图、pre-detected-conflict.png与geometry.json。自审已对照服务端授权、基线与CAS实现；生产未操作，本地fixture不替代真实认证/provider验收。专用Vite5194已停止，`lsof -nP -iTCP:5194 -sTCP:LISTEN` 已回读无监听。
