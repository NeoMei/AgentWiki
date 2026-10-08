# Task4 独立审查

- **Spec compliance：❌ Issues found。** 系统来源本地化、pending 稳定前置、头部动作和三种宽度布局已实现；新增冲突 guard 使尚未进入冲突暂停态的页面审核失去继续路径，不能按当前候选验收。
- **Code quality：Needs fixes。** 1 项 Important；2 项 Minor。审查范围为 `f5f45b8a3911c6818fa42b992b0fce340099f839..a1c68a267fd8d7c3de22f7687f52fb88e7df35de`。
- ⚠️ 此审查不证明 Task3 集成、真实认证/provider、生产授权或部署；报告中的 Chrome 证据使用本地 API fixture，原始用户场景仍须集成验收。依据：`agentwiki/apps/client/e2e/collaboration-system-layout.spec.ts:4`、`:23`、`:74`。

## Strengths

- `agentwiki/apps/server/src/collaboration-workflows/run.service.ts:1034`、`:1213` 从数据库关系提取系统所有权，移除内部关系；`agentwiki/apps/client/src/features/collaboration/systemTemplateText.ts:11`、`:16` 使用来源并让显式 `null` 禁止旧模板回退，避免误译自定义副本。五个 composite stableKey 已对照种子定义核实。
- `agentwiki/apps/client/src/features/collaboration/components/ArtifactPanel.tsx:8` 与 `ArtifactPanel.spec.tsx:7` 用显式 `previewFormat` 区分系统生成摘要与同名用户内容；`TaskPanel.spec.tsx:32` 覆盖无 legacy ID 的系统运行与 Agent 名保留。
- `agentwiki/apps/client/src/features/collaboration/components/ReviewPanel.tsx:28` 稳定前置 pending；`:37` 将操作放进 sticky 头部；`RunDashboard.tsx:399` 与 `collaboration-system-layout.spec.ts:62` 覆盖桌面滚动边界。已查看 1280px 截图并读取三个宽度的 geometry，左右边界和宽度断言与报告一致。

## Issues

### Critical

- 无。

### Important

- **[P1] 预先发现页面冲突后，待审核卡片没有可执行的处理路径。** `agentwiki/apps/client/src/features/collaboration/components/ReviewPanel.tsx:34` 将 `!comparison.conflict` 加入所有动作共用的 `canDecide`，但 `:35` 仅在 `run.pauseReason === 'page_version_conflict'` 时显示恢复入口。复现条件是普通 `waiting_review` Run 的页面被其他人修改，然后第一次加载比较：比较会返回 `conflict=true`，此时通过、驳回返工、终止和两项恢复动作全部消失，只显示只读。服务端比较只是查询（`agentwiki/apps/server/src/collaboration-workflows/run.service.ts:562`）；冲突暂停态原本由批准过程中检测冲突后写入（`review.service.ts:153`、`:159`），恢复接口又要求该暂停原因（`:313`）。新 guard 同时禁止用户到达这一步，且 `RunDashboard.tsx:295` 即使保留驳回按钮也会无差别拦截。请区分批准约束与驳回/终止权限，保留安全的退出/返工路径，并为预先检测到的冲突提供不依赖 approve 请求的恢复路径；不能用重新允许冲突 approve 绕过任务要求。补充 `waiting_review + pauseReason=null + comparison.conflict=true` 的动作可达性测试；当前 `ReviewPanel.spec.tsx:20` 只验证没有 approve，正好漏过此回归。

### Minor

- **[P3] 新增提交复核未覆盖页面审核的同序列权限撤回。** `agentwiki/apps/client/src/features/collaboration/RunDashboard.tsx:294` 仍只信任缓存的 `comparison.canDecide`；`:296` 的当前 `review.canDecide` 校验只适用于非页面审核。比较缓存仅随 run ID/eventSequence 清理（`:173`、`:186`），因此成员角色变更后刷新得到 `currentReview.canDecide=false`、eventSequence 未变时，仍可发出旧审批请求；保留 viewer 等成员角色会通过 `!humanRole` 校验。服务端仍重新鉴权，所以这不是权限越权，但实现报告“刷新撤回权限后不 POST”的表述目前仅对普通产物成立。建议页面分支同时要求当前 Review 能力并使权限刷新失效旧比较，增加同序列页面审核测试。
- **[P3] 浏览器证据日志含环境告警。** `.superpowers/sdd/2026-10-08-test-fixes/task-4-evidence/agentwiki-task4-browser.log:4`、`:6` 含 `NO_COLOR` 与 `FORCE_COLOR` 冲突 Warning；清理重复色彩变量后再生成后续验收日志即可，不影响本次 2/2 通过的事实。

## Checks / Evidence

- 按任务 reviewer prompt 只读检查候选 diff、brief、实现报告。首次工具输出中段截断，按 diff 行段补读；没有使用 Git 命令，没有修改候选代码，也没有重跑已覆盖测试。
- 聚焦检查一：新的审核 guard 是否与刷新失效、服务端冲突转换兼容。因 diff 截断了 `submitAction` 函数及其状态来源，读取 `RunDashboard.tsx:133`、`:173`、`:285` 的相关上下文；另查 `run.service.ts:502`、`:562`、`:989`，`review.service.ts:133`、`:196`、`:242`、`:313`，支持上述两个发现。未开展额外代码库审查。
- 聚焦检查二：系统来源映射是否对应真实种子。对照 `agentwiki/apps/server/src/page-templates/composite-template-definitions.ts:213`、`:220`、`:227`、`:234`、`:241`，五组 stableKey 与 legacy slug 一致。
- 读取现存日志：`task-4-evidence/agentwiki-task4-green-client.log:10` 记录 15 files / 269 tests passed；`agentwiki-task4-green-server.log:3` 记录 2 suites / 68 tests passed；`agentwiki-task4-browser.log:8` 记录两个 Chrome 用例通过。类型检查和 lint 日志未记录错误；空日志本身不单独证明退出码，成功退出码仍以实现者执行回执为准。
- 当前候选与独立审查结论分别记录；未将自动测试或本地 fixture UI 结果称为生产验收或部署。
