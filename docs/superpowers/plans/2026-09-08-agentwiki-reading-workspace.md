# AgentWiki Reading Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Execution method follows current user authorization; this plan does not start delegation or implementation.

**Goal:** 以已确认方案 2 实现持续可见的空间目录、宽正文、右上角本文目录浮窗，以及相关子页的连续导航。

**Architecture:** 新增仅负责呈现和导航状态的 SpaceWorkspace，复用已有页面、编辑器和目录 API。页面 ID 和空间 ID 仍为路由和数据事实源；编辑缓冲、权限、写入、版本冲突及审核继续由既有功能负责。普通空间功能页使用同一标题/导航外框和宽布局，不挂文章目录。

**Tech Stack:** React 18、React Router 7、TypeScript、Tailwind、现有 CodeMirror/Markdown 渲染、Vitest、Testing Library；沿用仓库 Node 和 pnpm 要求。

**Spec:** [已确认设计](../specs/2026-09-08-agentwiki-reading-workspace-design.md)

## Global Constraints

- “本轮只调整前端结构、呈现和导航状态。”
- “Space / Folder / Page 模型、权限事实源、Agent 绑定、协作审核、版本与冲突处理、同步协议和目录修订校验均不变。”
- “目录顺序使用现有服务端结果；不从路径构造虚拟 Folder，不让 Folder 承载正文。”
- “保存成功更新编辑基线，不自动切换阅读；保存过程中后续输入继续保持 dirty。”
- “所有新增界面文案通过现有中英文语言上下文，沿用语言持久化规则。”
- 不更换编辑器，不引入第二套大型组件系统；当前没有 components/ui 目录，不假定已有 shadcn Popover。先复用项目现有轻量浮层实现；补组件只限所需基础能力，不更换主题。
- 不修改 server、Prisma、同步协议、Local Sync 的业务代码。客户端请求字段与授权边界保持。
- 不自动发布、部署、合并或升级包。
- 真实工作树路径末尾有空格。执行阶段使用 using-git-worktrees 创建隔离工作树，显式指定实际 --work-tree；不修改五个已有 dirty submodule。
- 以下文件路径除 docs 外均相对 agentwiki/；命令在 agentwiki/ 执行。
- 执行状态以各任务复选框、SDD ledger 与本地验收报告为准；未执行项目不计为通过。

## 文件与接口边界

新增目录 apps/client/src/features/space-workspace/：

- SpaceWorkspace.tsx：空间公共标题/导航及 content/wide 两种内容槽位；不执行写操作。
- SpaceWorkspaceContext.tsx：跨页面导航保留浏览状态，按 userId + spaceId 隔离；退出登录清空，正文不写浏览缓存。
- workspaceNavigation.ts：文件夹 URL 参数、目录目标、返回位置和切页保护调用。
- useSpaceDirectory.ts：分层目录加载、分页及祖先定位、修订失效管理。
- SpaceDirectory.tsx：可访问的嵌套树与现有操作入口。
- ArticleContentsPopover.tsx：从真实正文标题构建右上角浮窗。
- PageInfoPanel.tsx：呈现已有来源与变更，承接现有版本和操作入口。

接口基线（实施可在同任务内细化，但必须保持调用方一致）：

```ts
type WorkspaceMode = 'content' | 'wide';
type ContentTarget =
  | { kind: 'folder'; folderId: string | null }
  | { kind: 'page'; pageId: string; folderId: string | null };
type DirectoryLevel = {
  parentFolderId: string | null;
  nodes: ContentTreeNode[];
  treeRevision: string;
};
type OutlineItem = { id: string; title: string; level: number };
type GuardedNavigate = (to: string) => void;
```

ContentTreeNode 沿用 features/content-tree/contentTreeTypes.ts。既有 SpaceView 的写操作由原有控制逻辑提供回调，目录组件只发起意图；不复制 create/move/delete 的业务实现。

### Task 1：工作区与导航上下文

**Files:** 新建 SpaceWorkspace.tsx、SpaceWorkspaceContext.tsx、workspaceNavigation.ts 及同名 .spec.ts(x)；修改 components/Layout.tsx、components/SpaceNav.tsx、App.tsx、context/LanguageContext.tsx。

**Consumes:** 已有 SpaceNav、Navbar、ProtectedRoute、现有空间/页面路由。
**Produces:** SpaceWorkspace 的 mode、spaceId、children 槽位及按空间隔离的浏览状态。

- [x] 在隔离工作树记录 base commit、原始状态，确认 Node/pnpm 与仓库 engines 一致。
- [x] 为 /spaces/:id、/pages/:id、/pages/:id/edit、/pages/:id/versions 定义共同外框；页面路由先获取真实 page.spaceId，不用页面 id 代替空间 id。
- [x] 先添加集成用例：读页到编辑页仍高亮“页面”；同空间切页保留展开状态；换空间或换用户不复用另一空间状态。
- [x] 运行新增用例，确认失败原因来自缺少工作区行为，然后接入公共布局与 context。
- [x] SpaceNav 增加显式 active section 支持页面路由；避免 /pages 路由导致无选中项。内部子路由分别归属协作或设置。
- [x] 目录选择采用 /spaces/:id?folder=:folderId，根目录省略参数；保留旧无参数 URL。浏览器前进/后退以 URL 为准。
- [x] 仅对工作区路由调整 Layout 的容器边距/宽度，避免影响首页、搜索和账户页面。
- [x] 验证并提交本任务涉及文件。

测试命令：
```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/SpaceWorkspace.spec.tsx src/features/space-workspace/workspaceNavigation.spec.ts src/components/SpaceNav.spec.tsx
```

### Task 2：目录树、祖先定位与现有目录操作

**Files:** 新建 useSpaceDirectory.ts、SpaceDirectory.tsx 及测试；修改 features/content-tree/contentTreeApi.ts、ContentTree.tsx、features/space/SpaceView.tsx 及已有测试；复用 contentTreeState.ts。

**Consumes:** Task 1 浏览状态，现有 listTreeChildren，GET /spaces/:spaceId/folders 的分页目录数据。
**Produces:** DirectoryLevel 缓存及目录选择/展开回调；新建目标采用 ContentTarget 的 folderId。

- [x] 构建合成树：根目录两文件夹、至少三层、重复页面标题、长标题、空文件夹、超过一页的子节点。
- [x] 先覆盖：折叠不切文章；选中目录才切目录内容；按真实 folderId 定位深链接；同名页面按 id 区分。
- [x] 添加只读 folders 分页客户端封装，沿用服务端响应类型及 parentId；停止条件为 nextCursor 为空。不要递归读取所有正文。
- [x] 深链接仅在本地索引不足时分页取得所需目录元数据，找到完整祖先链后结束；按层加载需要展示的节点。若页数间 treeRevision 改变，丢弃本次不一致结果并有限重试，持续变化则展示重试入口。
- [x] 同一个浏览状态中的目录级缓存按 treeRevision 失效；远端刷新后不能混合新旧顺序。请求取消与 generation 校验阻止换空间后迟到结果覆盖。
- [x] 把既有目录操作回调接入树和目录内容视图，保持 expectedTreeRevision、expectedUpdatedAt、delete-impact 确认及恢复语义。
- [x] 新建页面默认当前文件夹；选中文章则默认该文章 folderId；在现有弹窗中显示目标位置。
- [x] 实现键盘树导航、aria-expanded、完整名称、焦点可见的更多操作；触屏使用可点击入口。
- [x] 新增测试通过后回归既有 ContentTree/SpaceView，并提交。

关键状态测试示意（以现有测试工具建立相同 fixture）：
```ts
expect(requestsForChildren).not.toContain('unexpanded-folder');
expect(selectedPageId).toBe('page-a');
expect(expandedFolderIds).toContain('parent-of-page-a');
expect(createRequest.folderId).toBe('parent-of-page-a');
expect(moveRequest.expectedTreeRevision).toBe(serverRevision);
```

```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/useSpaceDirectory.spec.tsx src/features/space-workspace/SpaceDirectory.spec.tsx src/features/content-tree/ContentTree.spec.tsx src/features/space/SpaceView.spec.tsx
```

### Task 3：阅读布局、本文目录浮窗与页面信息

**Files:** 新建 ArticleContentsPopover.tsx、PageInfoPanel.tsx 及测试；修改 features/page/PagePreview.tsx/.spec.tsx，必要时为 components/Markdown.tsx 提供渲染完成通知，不改现有锚点生成。

**Consumes:** Task 1 shell、Task 2 directory；现有 Markdown 实际渲染标题和来源/变更数据。
**Produces:** 右上角本文目录与按需页面信息；阅读主内容不再永久保留来源列。

- [x] 先覆盖重复标题、中文标题、内联格式标题、代码块井号、无标题、标题变更和页面切换。
- [x] 从当前正文根节点下真实 h1–h6 及其实际 id 读取 OutlineItem，沿用 rehype-slug 和现有别名，不自行再造 slug；排除浮窗自身标题和非正文节点。
- [x] 本文目录默认关闭；锚定右上角触发器，约 280px 宽、最大高度受视口限制；不改变正文布局、不加遮罩。
- [x] 支持键盘与 Escape、外部点击关闭；当前章节通过正文滚动更新；点击目录项滚动至标题并处理 sticky toolbar 偏移。关闭方式分别管理焦点，避免跳回按钮把正文滚动复位。
- [x] 去除草图标题下方的通栏折叠目录；没有标题则隐藏入口。
- [x] 移动原来源与变更呈现到 PageInfoPanel，保留权限和操作条件；将编辑改为文字按钮，不增加副标题字段。
- [x] 正文宽度与方案 2 对齐；图片、表格、代码块不溢出工作区。
- [x] 验证并提交。回归 Markdown/task checkbox 测试，确保阅读中既有勾选功能未被移除。

```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/ArticleContentsPopover.spec.tsx src/features/space-workspace/PageInfoPanel.spec.tsx src/features/page/PagePreview.spec.tsx src/components/markdown
```

### Task 4：编辑连续性与离开保护

**Files:** 修改 features/page/PageEditor.tsx/.spec.tsx、workspaceNavigation.ts/.spec.ts；只在需要位置恢复时小幅扩展既有 MarkdownWorkspace 的外部句柄，不替换编辑内核。

**Consumes:** Task 1 导航接口、Task 2 目录选择回调、现有 isDirty/remoteUpdate/handleSave。
**Produces:** 所有工作区导航统一经过 GuardedNavigate；读写状态位置可恢复。

- [x] 先写关键场景：有修改时点击树另一页、父目录、空间功能页、版本入口、浏览器后退，取消离开后仍保留原文和原选中项。
- [x] 导航保护必须覆盖 Link、navigate 与浏览器 history；不能仅把原 guardNavigate 接到几个按钮。根据当前 Router 能力选择可阻断路径，并以用例证明，避免已经离开后才弹提示。
- [x] 目录选中项由成功导航后的目标派生，不在确认离开之前乐观切换。
- [x] 保存按钮保留原 handleSave；改成可辨识的文字状态。保存后不退出编辑；编辑器预览不触发网络写入。
- [x] 给“预览”和“返回阅读”不同入口；后者存在 dirty 时触发保护。保留附件、编辑辅助、版本历史、模板及协作入口的现有条件。
- [x] 保留保存中继续输入的 editRevision 逻辑：提交成功后后续新输入仍 dirty；remoteUpdate 与 409 错误继续可见且保留内容。
- [x] 以段落/标题锚点及光标位置恢复读写视图，普通首次打开另一文章从顶部开始，history 返回恢复先前位置。
- [x] 回归附件取消、编辑辅助流式写入、权限变化和 socket 更新；验证后提交。

必须保留的断言：
```ts
expect(savedRequest.expectedUpdatedAt).toBe(baseline.updatedAt);
expect(currentModeAfterSave).toBe('edit');
expect(patchCountAfterPreview).toBe(patchCountBeforePreview);
expect(isDirtyAfterEarlierSaveAndNewTyping).toBe(true);
expect(contentAfterCancelledNavigation).toBe(unsavedContent);
```

```sh
pnpm --filter @agentwiki/client test src/features/page/PageEditor.spec.tsx src/features/page/AgentAssistPanel.spec.tsx src/features/space-workspace/workspaceNavigation.spec.ts
```

### Task 5：历史页、创建与管理交互衔接

**Files:** 修改 features/page/PageVersionHistory.tsx/.spec.tsx、features/page-templates/NewPageDialog.tsx/.spec.tsx、features/content-tree/FolderDialog.tsx/.spec.tsx；目录移动/删除入口沿用 Task 2；必要时 PageInfoPanel.tsx。

**Consumes:** ContentTarget、原创建/历史/恢复业务处理。
**Produces:** 对象清晰的弹窗与确定的返回上下文，不新增业务能力。

- [x] 先测试从阅读页或编辑页进入历史后返回正确来源；直接打开历史 URL 没有来源记录时沿用现有编辑页返回默认。
- [x] 历史页显示所属空间/页面，允许临时收起左侧目录；返回后恢复。版本详情继续使用既有预览弹窗，不增加独立对比功能。
- [x] 恢复版本仍使用现有确认、修订校验和成功后进入编辑页的目的地，不把“返回来源”逻辑套到恢复成功操作。
- [x] 新建、改名、移动、删除展示准确对象及路径。复用旧流程；文件夹本身不创建正文。
- [x] 弹窗关闭后焦点回到原触发位置；若节点已删除则回到其有效父级。
- [x] 运行历史、创建、文件夹现有测试及新增导航用例，提交。

```sh
pnpm --filter @agentwiki/client test src/features/page/PageVersionHistory.spec.tsx src/features/page-templates/NewPageDialog.spec.tsx src/features/page-templates/NewPageDialog.composite.spec.tsx src/features/content-tree/FolderDialog.spec.tsx
```

### Task 6：其他空间页面的公共外框

**Files:** 修改 features/knowledge/KnowledgeGraph.tsx、source/SourcesPage.tsx、source/RunsPage.tsx、space/SpaceMembers.tsx、space/SpaceSettings.tsx、collaboration/CollaborationWorkspace.tsx、collaboration/TemplateEditor.tsx、collaboration/RunStartWizard.tsx、collaboration/RunDashboard.tsx、page-templates/PageTemplateManager.tsx 及对应测试。

**Consumes:** Task 1 SpaceWorkspace mode='wide' 与显式 SpaceNav active section。
**Produces:** 一致的空间标题/导航，保留各子页的业务布局。

- [x] 使用逐路由表测试核对 spaceId 来源，特别是图谱的 :spaceId 与其他路由 :id，不混入 runId/templateId。
- [x] 将重复 SpaceNav 包装替换为公共外框，避免双层标题和双导航；不移动或重写业务表单和处理函数。
- [x] 图谱、协作、来源等宽页面不常驻目录树；返回页面区恢复该空间原有目录状态。
- [x] 协作模板、启动向导、运行详情统一归属协作；页面模板管理归属设置，原返回路径有效。
- [x] 从搜索、审核及图谱打开页面，验证深链接对应真实目录；入口功能本身保持。
- [x] 对已有 dirty 表单保持现有离开保护；执行对应测试并提交。

```sh
pnpm --filter @agentwiki/client test src/features/knowledge src/features/source src/features/space src/features/collaboration src/features/page-templates/PageTemplateManager
```

### Task 7：完整路径验收、审查与交付

**Files:** 新建 docs/verification/reading-workspace-acceptance.md；只为验收发现的实际问题修改对应组件。沿用仓库现有测试框架，不引入第二套浏览器工具链。

- [x] 在隔离本地测试环境准备合成 fixture：三层目录、200+ 同级节点、重复/长名称、长 Markdown、代码/表格/图片、只读用户；沿用已有测试数据工具，不写真实生产内容。
- [x] 完成“目录 → 阅读 → 本文目录跳转 → 编辑 → 保存 → 预览 → 历史 → 返回 → 切换空间功能 → 返回文章”真实浏览路径。
- [x] 验证桌面 1440px 与手机约 390px，键盘访问浮窗和树、中英文切换、刷新与浏览器前进/后退。
- [x] 在同一 viewport 对照已选修订草图与实现截图，检查正文宽度、浮窗覆盖、工具栏、目录密度和溢出；截图不能替代实际点击及保存。
- [x] 注入加载失败/409/保存中远端变化/权限撤销，确认原错误路径、缓存失效及内容保留。
- [x] 执行客户端完整测试、lint/build 和仓库 typecheck；若锁文件/依赖或共享模块发生变化，按受影响范围扩展仓库回归。禁止连接生产库运行测试。
- [x] 对完整 diff 审查：无后台模型或写语义变更、无隐藏能力删除、无误改其他子模块；每个测试失败需给出修复或具体环境阻塞，不把未跑算通过。
- [x] 验收报告记录实际命令、真实路径、环境、浏览结果、截图与未验证项；同步计划复选框。只交付本地候选，不擅自发布。

```sh
pnpm --filter @agentwiki/client test
pnpm --filter @agentwiki/client lint
pnpm --filter @agentwiki/client build
pnpm typecheck
```

## 顺序与审查

按 Task 1 → 2 → 3 → 4 → 5 → 6 → 7 执行。每个任务先验证其真实行为，再按任务范围提交；不把共享布局、编辑保护和后台规则放进一个无法独立审查的大提交。执行时采用用户授权的协作方式；若使用子代理，每个任务结束先检查范围符合性，再检查代码与回归，最后做全分支审查。

## 设计覆盖自查

- 核心页面与目录持续可见：Task 1–4。
- 本文目录右上角浮窗：Task 3。
- 历史/创建/目录操作：Task 2、5。
- 其他空间子页外框及嵌套入口：Task 6。
- 后台边界、读写保护、同步/权限相关前端回归：Task 2、4、7。
- 小屏、双语、键盘、深链接与真实流程：Task 1–7，Task 7 汇总验收。


最终交付：代码1d1b0a81，本地候选；1395测试及lint/build/仓库typecheck通过。已报告R1–R6均关闭，原生拖拽与移动后保存经浏览器操作/API回读通过。外部Agent流程等验证边界见agentwiki/docs/verification/reading-workspace-acceptance.md。
