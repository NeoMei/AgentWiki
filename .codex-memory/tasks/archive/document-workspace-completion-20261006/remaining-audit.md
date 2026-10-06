# OpenKnowledge 体验剩余项：手工编辑、阅读、目录只读审计

审计时间：2026-10-06。HEAD `f1ed2bb0d7d8b7faedb218405d87fb070ffd58f7`，工作树 `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki `（尾空格）。本文路径均相对于其 `agentwiki/`。已读原始借鉴研究、两份实施计划、两轮验收与可视编辑探针报告。CodeGraph explore 返回没有索引后使用 rg/源码读取；未改源码、未运行测试、未派生代理。

## 结论

两份计划的 checkbox 已完成，但原始体验目标仍有未进入计划/被缩窄的部分。最值得本轮补齐的是：选区切换连续性、目录当前页自动可见、右侧面板偏好；真正的可视块操作仍是最大未交付能力，需要以原文片段事务实现，不能把 Tiptap 全文往返失败误写为该产品目标已经完成。

### 原始目标遗漏或部分完成

| 项目 | 实际证据 | 最小可实施方案 |
| --- | --- | --- |
| 编辑→预览→编辑保留非空选区 | 原研究要求位置/选区可恢复。`components/MarkdownWorkspace.tsx:626` capture 仅保留 selection.main.head；`:649` restore 固定 EditorSelection.cursor。`features/page/PageEditor.tsx:543` 只带回 cursorOffset。当前能保持段落和光标，不能恢复原选区范围/方向。 | 模式位置加入可选 anchor/head/quote（无需持久保存正文）；同一身份/页面/原文仍匹配时恢复原选区；预览主动浏览到其他段落则沿现有语义定位，不恢复旧范围；编辑期间原文变化严格校验。覆盖正向/反向/重复文本/预览滚动/失效回退及真实UI。 |
| 当前页面目录自动可见尚不完整 | 祖先加载/展开已存在：`features/space-workspace/useSpaceDirectory.ts:182` ancestry 与`:241` setFolderExpanded。手动 reveal 已存在。但 `SpaceDirectory.tsx:83` 只有保存scrollTop===0或手动revealPending才scrollIntoView；在已有非零目录滚动位置时，通过搜索/链接进入另一页虽展开祖先，却可能把选中行留在视口外。 | 区分“首次恢复用户浏览位置”和“当前页真实切换”；页面ID变更后的当前节点加载完成时仅在行不可见时 nearest reveal；清理或明确处理隐藏当前项的本地过滤；保留同页目录手动滚动与刷新恢复。 |
| 右侧大纲/协作面板偏好未实现 | 原研究要求“目录和面板宽度、展开状态按用户与Space保存”。`workspacePreferences.ts:1` 仅4个directory字段；`ArticleContentsPopover.tsx:84` open=false，`:94` pageKey/宽度变化便setOpen(wide)，`:100`宽度220/280固定；`PageEditor.tsx:170` assistOpen/notesOpen仅组件state，`:1262`固定w-80。 | 独立偏好记录用户+Space的outlineOpen、协作面板activeTab/open/desktopWidth；安全夹紧和存储失败退化；手机以临时抽屉布局展示，勿用手机宽度覆盖桌面偏好。不要持久化候选正文或任务身份，权限不足不自动打开不可用功能。 |
| 真正可视块编辑仍未交付 | `docs/verification/document-workspace-20261006/visual-editor-spike.md` 明确“没有实现产品可视编辑UI”；`components/markdown-tools/commands.ts:32`只是标准Markdown片段插入；`MarkdownWorkspace.tsx:316`主要语法装饰，未提供表格单元格/行列、图片属性、列表结构的可视操作。 | 先选一个真实可视能力落地：光标所在GFM表格的局部表格编辑器（单元格、增删行列、对齐），只提交该表格source span的CM事务，一步撤销；引用定义/未知语法/表格外字节完整保留；存在不支持嵌套结构就回到源码，不能全篇serialize。图片alt/链接属性可同一原文片段模式后续加。此项是原始并行试点的后续产品门槛，不是要求全量换库。 |

### 合法缩窄且诚实说明，宜作为下一项增强而非既有实现错误

- **页面链接检索只覆盖最近100页。** `components/markdown-tools/useAuthorizedPageLinks.ts:20` GET /pages take100；`DocumentTools.tsx:78`本地filter且`:93`明确说明范围。第一轮计划/验收允许已加载范围，因此不是隐瞒或回归；但原建议“查找当前Space页面”在大空间仍不完整。最小方案优先服务器标题检索（已有`core/search/search.controller.ts:16`授权spaceId搜索，但service还会调用embedding，并非纯轻量标题查询）；可扩充pages受权title query并返回分页，或debounced现有search。必须abort/代次隔离、结果Space检查、保留原文锚点；不要通过一次拉取所有全文页面实现。
- **目录只过滤已加载分支。** `SpaceDirectory.tsx:97`与`:153`明确限定，第一轮计划允许此fallback；已经有全局搜索入口，不能称整个目录搜索尚未完成。若本轮要改为完整目录搜索，需服务端对folder/page同权限搜索和祖先路径，前端虚拟搜索结果不能驱动原始树排序。
- **宽屏大纲“常驻”已有，但用户关闭习惯丢失。** 窗口>=1600时默认自动开，故不能把大纲侧栏整体列为未做；未完成的是上表偏好和可调宽度。

### 已完成，勿重复派任务

- 就近选区工具栏已经实现：`DocumentTools.tsx:27–39`按coordsAtPos计算fixed位置，`:81`切换floating样式；源码fallback也在。可以验收边缘定位，但不是尚无选区工具。
- 格式、斜杠表格/代码插入、图片上传入口、撤销隔离、页面链接选择已有。原研究“图片”不是只剩一个不存在的按钮。
- 任务勾选已有预览交互：`MarkdownWorkspace.tsx:884`调用toggleMarkdownTask，不要把所有任务列表都列为未支持；尚缺编辑画布上的结构操作。
- 目录文字菜单、行内新建/重命名、展开/滚动/宽度缓存、当前页祖先加载和手动定位、键盘菜单已交付。
- 阅读与编辑共用画布、AST大纲、重复标题定位、段落语义跳转和历史POP恢复已交付。源字节保真和权限版本保护不是欠账。

### 已明确排除 / 仅验收边界

- **已明确排除当前方案**：全量替换Tiptap、CRDT迁移、复制GPL源码。Tiptap17语料只有1项源字节保持，不能为了可视表格而忽略其探针结论；局部源片段UI仍可独立实现。
- **仅验收边界**：真实macOS中文IME、Windows、真实多人压力、外部Agent provider、OpenKnowledge桌面实机；这些不能靠增加按钮补完或拿测试数量宣称完成。IME与大/深目录/长文浏览器验收可在本环境继续，其余需相应环境。
- **集成/发布边界**：当前本地分支完成不等于上线，原计划明确没有merge/push/deploy；用户本轮要求补体验本身不自动授权发布。

### 可附带的目录可用性风险（未实机复现，不当作已确认缺陷）

`ContentTree.tsx:353`节点操作菜单absolute/top-full位于`SpaceDirectory.tsx:163`overflow-y-auto容器内，未见portal、边界翻转、外点关闭或全树单菜单约束。长目录底部行可能需要额外滚动才能触达菜单。若本轮做目录自动定位，可一次真实浏览器覆盖底部菜单，再决定是否需要统一portal/clamp，而非凭源码直接声称失败。

## 模型/账号核验

本代理没有model/effort覆盖，继承启动，也没有fallback。最新本代理日志 `rollout-2026-10-06T17-36-15-01a11092-243d-7e41-b745-c99c612535c1.jsonl` 的 `turn_context`：`2026-10-06T09:36:19.514Z`，turn_id `01a11092-24a7-7770-95f3-14354c139c3d`，model `gpt-6-astra`，effort `ultra`。可见字段没有p5c07ff前缀；已报告父代理，不能据此宣称已验证p5账号。

## 审计依据与记忆

只读使用项目现况及当前源码为主。全局记忆只用于核对既有独立实施/审查偏好：`MEMORY.md:1952`；未依赖旧记忆来断言本轮实现。

## 研究文档的状态需同步

原始 `docs/research/openknowledge-20261006/借鉴分析与改造建议.md:3` 仍写“尚未实施产品改造”，与两轮验收不一致。建议保留当时基线/截图历史，在文首注明该文是2026-10-06的获批研究，并新增覆盖矩阵：原始目标 → 当前实现/证据 → 本轮补齐 → 明确延后/环境门槛。不要只把两份实施计划全部勾选当作原始长期体验目标全达成。
