# 10-08测试修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** 修复并验证10-08测试报告15项问题。
**Architecture:** 沿用现有React/Nest/同步协议，按共同组件和能力契约修复。先通过本地fixture复现，再作最小实现与独立审查；独立Obsidian仓库在其隔离分支处理。
**Tech Stack:** React 18, CodeMirror 6, TypeScript, NestJS, Prisma, Vitest, Jest, Playwright。
**Spec:** /Users/neomei/.codex/worktrees/test-fixes-20261008/AgentWiki /agentwiki/docs/superpowers/specs/2026-10-08-test-fixes.md

## Global Constraints
- 默认中文；新增界面文案同时支持简体中文和英文，复用现有语言上下文和组件风格。
- 不放宽 Space 权限或允许列表，不自动审批、发布、覆盖用户文档。
- Markdown 保留互斥编辑/预览、显式保存、候选→草稿→保存、Undo/Redo、中文输入法组合契约。
- 所有复现使用本地测试数据；不在生产真实文档上执行破坏性测试。
- 未复现的原案保持待验，自动测试、独立审查、真实UI验收、部署分别记录。
- 旧运行记录深链接、重试/取消与跨来源汇总在导航合并后仍可用。
- 原误删恢复已完成，不再执行任何恢复脚本。任何凭据不写入文件或提交。

### Task 1: 目录、菜单与错误展示（#1/#10/#12/#13/#15）
Files: apps/client/src/features/content-tree/ContentTree.tsx 与 spec；features/space-workspace/SpaceDirectory.tsx、useSpaceDirectory.ts 与 specs；features/space/SpaceView.tsx 与 spec；features/knowledge/KnowledgeGraph.tsx 的错误展示；语言资源及必要共用小组件。
Interfaces: ContentTree 可增加可选 highlightQuery；所有调用方默认兼容。空间标题布局不再依赖折叠目录宽度。复用 apiErrorMessage。
- [x] 对中文Axios403目录及图谱、右侧/跨树菜单互斥/点外/Esc/动作关闭、过滤高亮、折叠标题可读加入有意义回归。菜单目标在真实几何遮挡下不得误触其它动作；减少原生details散落行为。
```tsx
fireEvent.click(within(firstRow).getByLabelText(/操作/));
fireEvent.click(within(secondRow).getByLabelText(/操作/));
expect(within(firstRow).queryByRole('button', {name:'删除页面'})).not.toBeVisible();
fireEvent.pointerDown(document.body);
expect(screen.queryAllByRole('menu')).toHaveLength(0);
```
- [x] 运行 focused Vitest 确认真实失败，再最小修复；例如错误使用 `apiErrorMessage(error, t, ...)` 的实际签名，不造新英文fallback。
- [x] 将菜单互斥/外部关闭放到共用ContentTree行为，移除重复局部逻辑；高亮按字面量分段用React文本/mark，勿dangerouslySetInnerHTML。
- [x] 去掉目录 /search 链接，保留顶栏搜索与过滤；折叠后标题容器保留文字空间，小屏不造成横向溢出。
- [x] 运行上述全部相关spec与client typecheck，报告RED/GREEN、修改文件、commit。真实浏览器由最终验收补足；不要将CSS结构测试称视觉验收。

### Task 2: Agent 对话跟随与编辑器稳定性（#9/#11）
Files: features/agent-session/AgentSessionPanel.tsx/spec；components/MarkdownWorkspace.tsx/spec；必要e2e长文fixture。
Interfaces: 现有onChange/onSave及session API保持不变。参考 /tmp/agentwiki-1008-editor-diagnosis.md。
- [x] 建立会话长列表发送、近底部新回复跟随、上翻历史不抢滚动、切换会话定位的失败用例。
```ts
// 可控scrollHeight/clientHeight/scrollTop，发送和轮询应分别验证
expect(turns.scrollTop).toBe(turns.scrollHeight - turns.clientHeight);
```
- [x] 长文包含标题/列表/粗体/链接/表格，浏览器记录输入前后doc、selection、滚动锚点和extension重配置；确认根因再改。需要把活动行源码显示与非预期抖动分开。
- [x] 稳定CodeMirror extensions/plugin身份，仅在doc/selection/parser必要变化刷新decorations；不靠禁用Markdown展示规避问题。
- [x] 新回复只在用户接近底部时跟随，本人发送强制定位；保留上翻历史位置，处理流式内容/异步尺寸、卸载清理。
- [x] focused tests及client typecheck通过，记录尚需原生IME的边界并commit。

### Task 3: 模板/绑定能力契约（#3/#14）
Files: server page-templates composite-template-catalog.service.ts/controller.ts/template-feature-policy.ts/specs；client api/type/capability hook/PageAgentBindingDialog/SpaceView/PageEditor与spec。
Interfaces: 不同能力明确为普通页面组创建、模板定义管理、纯绑定、启动现有页面协作；具体字段名实现时统一前后端，兼容缺字段时保守拒绝受限写。
- [x] 添加allowed/disallowed Space × owner/admin/editor/viewer测试，断言公开能力与真实路由权限一致；不把role-only canCreate用于allowlist动作。
```ts
expect(capabilities.canSaveFolderTemplate).toBe(false); // 未开放Space
expect(capabilities.canBindAgent).toBe(true); // 合法editor的纯绑定
expect(capabilities.canStartPageCollaboration).toBe(false);
```
- [x] 将纯保存绑定与立即启动拆清：关闭的启动不可勾选/有中文原因；合法纯绑定仍能完成。现有乐观版本冲突与授权检查保留。
- [x] 保存目录模板不能靠默认放宽后端开关修复；入口显示真实可用性，必要禁用并解释。
- [x] 运行server/client契约回归与两边typecheck，commit并提交接口说明给Task4/Task5。

### Task 4: 协作本地化、审核与卡片布局（#4/#5/#6）
Files: RunDashboard.tsx/systemTemplateText.ts/components/TaskPanel.tsx/ReviewPanel.tsx/ArtifactPanel.tsx/ActivityPanel.tsx；必要server run DTO系统模板来源标识；语言资源、unit/e2e。
Interfaces: 消费Task3能力；系统来源需可验证，不能凭用户文本相等随意翻译自定义内容。
- [x] 加组合运行templateId=null但来自系统模板的文本翻译失败测试；覆盖任务名/目标/Todo/审核标准/产物名，保留用户自定义与Agent名称。
- [x] pending reviews稳定排序前置；卡片头部常驻动作。页面比较可自动加载或动作触发后加载确认，但审批不得绕过comparison.canDecide、baseline和冲突检查。
```tsx
expect(reviewCards[0]).toHaveTextContent('等待审核');
expect(within(reviewCards[0]).getByRole('button',{name:'通过'})).toBeVisible();
// 未加载或冲突状态不发送approve请求
```
- [x] 修复右列网格min-width/overflow/滚动边界，长文本、1912px/1280px/390px实际渲染所有边框可见。
- [x] unit及相关Playwright真实DOM布局验收，记录截图、测试，commit。

### Task 5: 图谱选中标签与来源运行统一（#7/#8）
Files: KnowledgeGraph.tsx/graphLabelLayout.ts/spec；SourcesPage.tsx/RunsPage.tsx/Space导航/routes及现有e2e。
Interfaces: 原 /spaces/:id/runs 与详情链接保持有效（可重定向至来源页运行tab并携带runId）；来源页承接跨来源运行、重试和取消。
- [x] 图谱默认无标签，选中仅一个节点名，切换选中更新、空白清空，连线/节点点击/缩放功能保留。
- [x] 来源页设来源/运行两种视图，空间顶层去掉重复运行入口；旧深链接带runId打开同一详情，所有授权/重试/取消不变。
```ts
expect(screen.queryByRole('link',{name:'运行记录', exact:true})).not.toBeInTheDocument(); // 仅空间顶级导航
// 旧runs/ID route能显示同一run，重试/取消仍调用原API
```
- [x] unit与路由e2e证明保留能力；图谱真实canvas截图验证，commit。

### Task 6: Obsidian 父节点合并与映射目录（#2）
Files: 独立AgentWiki-Obsidian仓库的application/tree-diff.ts及其spec，映射创建/adapters已有测试；确切隔离worktree待Task执行前由root建立。
Interfaces: 协议不变，保留文件夹id/页面id/路径；安全合并不得静默丢远端新增子节点。
- [x] 根据 /tmp/agentwiki-1008-obsidian-diagnosis.md 复现base父目录存在/local删除/remote新增子目录或页面孤儿；首次全量同步与分页也验证。
- [x] 建真实三方合并失败用例，再修删除信息/冲突或合法提升语义，保持用户选择和本地既有文件。
- [x] 验证自动建嵌套映射目录、已存在目录复用、文件占位报清晰错误，勿重复实现已有能力。
- [x] focused及插件全套必要回归、构建，通过独审。原测试者插件版本与本轮Windows/真实Vault未覆盖时明确待验，不因新边界修复宣称原案闭环。

### Task 7: 整体验收与交付记录
Files: agentwiki/docs/verification/test-fixes-20261008/；必要本地e2e测试fixture。
- [x] root运行 client/server完整相关回归、typecheck、lint、build；仅既有/环境skip单独记录。
- [x] 使用本地fixture在实际Chrome验收15项能覆盖路径；每次菜单操作先读当前UI并确认无遮挡，仅本地数据允许写。
- [x] 固定候选SHA后整分支独审；修重要问题并复审。
- [x] 产出15项状态矩阵（代码/独审/UI/原案/部署），保留未覆盖项；更新项目current及task brief。授权不足的发布部署保持未执行，不报全线上已修复。


本地候选阶段于2026-10-08完成；原案/原生/环境未验边界和源码SHA分别见 `docs/verification/test-fixes-20261008/status.md`，不代表发布部署。
