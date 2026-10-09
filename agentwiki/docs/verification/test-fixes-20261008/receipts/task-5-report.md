# Task 5 实现与验收报告

## 候选
- worktree: `/Users/neomei/.codex/worktrees/test-fixes-navigation-20261008/AgentWiki `（尾空格）
- branch: `codex/test-fixes-navigation-20261008`
- base: `e039fb652fd0d5f53bbd6d922a5cb7d05010cce1`
- 产品提交: `913335fd` — fix: unify source runs and show only selected graph labels
- 集成 lint 小修提交: `593cf71b` — fix: use explicit branching for menu keyboard toggle
- 产品候选工作树 clean；没有 push/merge/release/deploy。

## 实现
- KnowledgeGraph 默认不画名称，只布局选中的一个节点标签；节点/下拉切换更新，空白清除。保持原边/节点绘制、关系创建删除、双击导航、缩放/平移/拖动。移除不再适用的“隐藏名称”提示。
- 标签使用原测量与2行省略，密集场景允许边界内fallback；短viewport自动缩为1行。优先位置仍避节点。
- SourcesPage query `view=runs` 承接来源/运行两个tab。RunsPage及其汇总/详情/产物/审核链接/刷新/轮询/重试/取消实现原样复用，来源创建上传运行等原能力保留。
- tab支持方向键/Home/End与roving tabIndex，使用现有中英词条，未增加组件体系。
- SpaceNav去顶层 Runs；legacy `/spaces/:id/runs?run=ID` 与 `/spaces/:id/runs/:runId` replace重定向到来源运行tab，其他query保留；selected section为sources。
- 来源运行详情与失败运行入口直链到新tab，携带runId；IngestRunDetails不改权限逻辑。查询run只有存在于当前授权space run列表后才读取详情。
- 未修改SpaceView/PageEditor、collaboration、system-collaboration-messages和messages.ts。
- 主任务追加授权的TreeActionMenu:106 lint修复仅将表达式语句改等价显式if/else，单独提交，不引入新功能。

## TDD/验证证据
工作目录为worktree下`agentwiki`：
- RED：`pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/graphLabelLayout.spec.ts src/components/SpaceNav.spec.tsx src/features/source/SourcesPage.spec.tsx`，8个新增需求失败；`/tmp/agentwiki-task5-red.log`。
- route RED：恢复base App路由后实际Chrome两种旧run链接均失败；`/tmp/agentwiki-task5-route-red.log`；原失败trace保留`/tmp/agentwiki-task5-route-red/`。
- keyboard RED `/tmp/agentwiki-task5-tabs-red.log`；短viewport RED `/tmp/agentwiki-task5-small-viewport-red.log`，均修复后GREEN。
- unit：graphLabelLayout、KnowledgeGraph、SpaceNav、SourcesPage、RunsPage、workspaceNavigation六文件 **94/94**，`/tmp/agentwiki-task5-unit.log`。测试覆盖原来源权限/上传/运行/竞态、原运行授权/轮询/动作、canvas手势/关系操作、唯一标签、tab键盘。
- 最后spec语法兼容修正单文件 **6/6**，`/tmp/agentwiki-task5-short-viewport-green.log`。
- `AGENTWIKI_WEB_URL=http://127.0.0.1:5195 pnpm --filter @agentwiki/client exec playwright test e2e/source-runs-navigation.spec.ts e2e/q2-graph-images.spec.ts --workers=1`：实际Chrome **4/4**；`/tmp/agentwiki-task5-e2e-green.log`。
- route e2e使用真实App和synthetic身份/API fixture；两种旧链接同详情、展开产物、来源tab保留Add source、retry/cancel原API、foreign-run不读取、390px无横向溢出。
- canvas真实渲染fixture：60节点默认无文字；单击中文节点、下拉切换两个名称、空白清除、桌面/390px fit/zoom、双击节点打开。
- `pnpm --filter @agentwiki/client build` GREEN；`/tmp/agentwiki-task5-build.log`（已有Mermaid chunk体积warning）。
- changed-file eslint GREEN `/tmp/agentwiki-task5-changed-lint.log`；全量lint原先唯一TreeActionMenu阻断留`/tmp/agentwiki-task5-lint.log`。
- 追加小修后 `pnpm --filter @agentwiki/client lint` GREEN `/tmp/agentwiki-task5-lint-final.log`；ContentTree/FolderDialog/state/API unit **30/30** `/tmp/agentwiki-task5-menu-unit.log`；actual Chrome content-tree-menu e2e **2/2** `/tmp/agentwiki-task5-menu-e2e.log`；最终 `tsc --noEmit` GREEN `/tmp/agentwiki-task5-typecheck-final.log`。
- diff --check GREEN；自审明确scope且保留Task1图谱错误本地化。

## 截图与环境
- Task5最终截图与e2e输出完整复制：`/tmp/agentwiki-task5-final-evidence/test-results/`；已实际查看graph-default-desktop、graph-selected-1200-p59、sources-runs-detail。
- 图谱目录 `q2-graph-images-real-canva-bec43-pace-and-keeps-zoom-working/`，含desktop/mobile selected/default/cleared。
- 来源路由目录 `source-runs-navigation-pre-3eba8-s-task5-runs-run-failed-run/` 与`source-runs-navigation-pre-2643d-paces-task5-runs-failed-run/`，含desktop/mobile。
- 菜单截图 `/tmp/agentwiki-task5-menu-evidence/test-results/`。
- 专用Vite5195仅本地，API全部route fixture拦截，未连接真实文档/生产。自建Vite进程已终止、5195已释放。无数据库资源。

## 自审/限制
- 需求逐项通过，未发现需进一步修改项；等待独立review/主候选集成，以上不等同真实后端权限验收或部署。
- 原运行页前端按钮授权策略保留，服务端仍负责权限；不新增grant或绕过成员校验。
- dense fallback可与节点附近区域交叠（仍唯一label且画布内），选中节点离屏时不画标签，先fit/平移即可；符合原屏幕空间布局规则。
- 两个视图切换卸载旧组件，原请求序号/Abort/poll cleanup沿用；来源未提交表单切换会重置（现有其他页导航相同行为）。
