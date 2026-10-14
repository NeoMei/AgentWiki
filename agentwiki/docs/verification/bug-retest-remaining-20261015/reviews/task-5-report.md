# Task 5 report — #13 图谱分组浏览

状态：初轮实现、`35be76ca` 复审的两项 P2 及最终 CUA 双击边界修复完成。主任务已反馈最右缘真实双击导航验收通过；全客户端补测 155 文件、2549 测试通过。此补测轮未提交/暂存，未操作 UI 或生产；整体发布门禁及发布由主任务执行。

## 根因

1. 图谱接口已有全量页面节点、`folderId` 与 canonical `path`，但没有 Folder 元数据；前端仅绘制同大小页面圆点，默认不画标题，无法按真实目录浏览。
2. 前端另行调用 `/pages?spaceId=...`，没有翻页，仅用默认首批页面作为建立关系的目标；这与图谱的全量节点不一致。
3. 原筛选仅为关系来源，不能按 relation 类型筛选；选中信息位于画布下方，没有展示 canonical path，关联页数量按关系条数计算，会重复计数同一页。

## 实现

- `KnowledgeService.getGraph` 保持原路由/MCP 的 Space `graph:read` 授权、来源投影及写入规则；新增同 Space、`deletedAt: null` 的全部 Folder 元数据（id/name/path/parentId）。接口仍是全图，不使用分页；空页面空间也返回空文件夹。
- 前端仅请求图谱接口，直接复用全量节点做搜索与建立关系候选；125 页 fixture 证明第 125 页可以被选为目标。
- 默认展示真实 Folder 分组、完整目录路径和直接包含的页面数；空目录保留，根目录页面显示“未分组”，失效 Folder 引用显示“文件夹不可用”，不从页面路径猜目录。
- 分组卡片和 Canvas 分组节点均可展开；展开卡片提供带标题与路径的键盘可访问页面节点按钮。Canvas 使用既有 viewport，保留缩放、适应、重置、平移、拖拽、双击打开；可切换原全部页面节点模式。
- 增加标题/路径搜索、明确的匹配数量和无匹配清空画布状态，支持清除筛选；relation 类型筛选与原 origin 筛选可组合。
- 选中页面在右侧栏展示标题、canonical path、去重关联页面数、实际关系数、可打开的关联页面链接、既有关系证据/来源详情、建立关系和打开页面入口；窄屏按顺序堆叠。
- 切换 Space 忽略旧读请求回执；分组展开的双击不会被误当成打开页面。
- 新文案放 `bug-graph-messages.ts`，由功能组件使用 `bugGraphText(language, key, params)` 懒加载，不进入共享首屏 messages.ts。

## 文件

- `apps/client/src/features/knowledge/KnowledgeGraph.tsx`
- `apps/client/src/features/knowledge/KnowledgeGraph.spec.tsx`
- `apps/client/src/features/knowledge/KnowledgeGraph.grouped.spec.tsx`（新增）
- `apps/client/src/features/knowledge/graphGrouping.ts`（新增）
- `apps/client/src/features/knowledge/graphGrouping.spec.ts`（新增）
- `apps/client/src/i18n/bug-graph-messages.ts`（新增）
- `apps/server/src/core/knowledge/knowledge.service.ts`（仅 getGraph）
- `apps/server/src/core/knowledge/knowledge.service.spec.ts`

## 验证

先红后绿：新增服务端全量 Folder 元数据断言，在原实现下失败（响应没有 folders），实现后通过；分组纯逻辑测试先因缺少实现失败，新增实现后通过。

- `pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/KnowledgeGraph.spec.tsx src/features/knowledge/KnowledgeGraph.grouped.spec.tsx src/features/knowledge/graphGrouping.spec.ts src/features/knowledge/graphLabelLayout.spec.ts`：4 文件、41 测试全部通过（含两轮复审新增回归）。
- `pnpm --filter @agentwiki/server exec jest --runInBand src/core/knowledge/knowledge.service.spec.ts src/core/source-freshness/source-response-boundaries.spec.ts src/knowledge-graph/knowledge-graph.controller.spec.ts`：3 文件、30 测试全部通过。
- `pnpm --filter @agentwiki/client exec tsc --noEmit`：通过。
- `pnpm --filter @agentwiki/server typecheck`：通过。
- 本次 8 个 TS/TSX 文件定向 eslint：通过。
- `git diff --check`：通过。

客户端覆盖：实际/嵌套/空目录与未分组数量、展开/选中/路径与关联跳转、搜索完整路径与无结果清空画布、筛选 relation 与 origin、唯一关联页面计数、125 页完整候选、空目录空间、中英切换、跨 Space 旧请求隔离、既有鼠标/Pointer/高 DPI/缩放/平移/拖拽/双击导航。
服务端覆盖：120 个页面无截断、Folder Space/live where 条件、canonical 字段、无页面时空目录保留、原来源授权投影与关系写权限测试。

## 主任务验收提示 / 限制

- API 进程若从既有 dist 运行，需要主任务统一构建/重启后才能返回 folders；本子任务遵照隔离 fixture 约束没有构建或清理 dist。
- 请在主任务 4399/5199 fixture 核对真实目录数量、展开、标题/路径搜索、类型过滤、选择侧栏与打开页面，并检查 390px 布局；本报告不将组件测试当作浏览器验收。
- 目录数量是“直接包含”而非递归子目录总数，页面旁有说明。嵌套目录通过真实完整 path 区分，未制造额外目录层级。
- 本轮未更改原报告条目状态，未完成生产发布或原空间回放。

## 2026-10-15 复审修复回执（对应 task-5-review.md / 35be76ca）

### P2：首次双击因详情侧栏改变 Canvas 宽度而打开相邻页面

- 已验证原问题：新增测试执行完整 `mousedown/up/click(detail=1)` → 侧栏出现 → ResizeObserver 将 1000px Canvas 缩至 664px 并 fit → 同坐标 `mousedown/up/click(detail=2)/dblclick`。原代码实际导航至 `p2`，断言目标 `p1` 失败。
- 修复：在首次 click 记录页面 ID；同一原生 double-click 序列的第二次 click 不重新切换选择，dblclick 打开首次命中 ID。空白/分组不作为页面目标，拖拽抑制保留，新 Space 清除目标，导航前确认目标仍在当前筛选节点集。
- 定向结果：该真实双击序列及既有鼠标/Pointer/延迟兼容事件相关用例通过。

### P2：关系来源筛选覆盖用户拖拽布局

- 已验证原问题：全部页面和分组模式分别将节点拖动 (+80,+60) 后切换 Manual，原代码立即恢复原坐标；新增两条用例均先失败。
- 修复：将 `layoutGroupedNodes` 与 `projectGroupedEdges` 分开。纯来源边变化不再触发节点初始化；实际拖拽坐标按 Space、视图模式、节点 ID 记录，节点被筛选隐藏后恢复时仍回填坐标。新 Space 清空记录，两个视图互不覆盖。
- 定向结果：两种模式中切换来源、组合 relation 筛选隐藏全部节点、再次恢复节点，坐标均保留。新增跨 Space 测试使用同一个 `group:ungrouped` 合成 ID，确认新 Space 不复用旧空间拖动位置；既有旧异步请求隔离测试继续通过。

### 本轮验证与范围

- 新增红阶段：`KnowledgeGraph.spec.tsx` 25 条中新增 3 条失败、原 22 条通过；失败实际分别为打开 p2、两种模式恢复原坐标。
- 最终 `KnowledgeGraph.spec.tsx` / `KnowledgeGraph.grouped.spec.tsx` / `graphGrouping.spec.ts` / `graphLabelLayout.spec.ts`：4 文件、40 条全部通过。
- 客户端 `tsc --noEmit`、4 个本轮修改文件定向 eslint、`git diff --check`：通过。
- 本轮仅修改 `KnowledgeGraph.tsx`、两个 KnowledgeGraph 测试文件、`graphGrouping.ts` 与本报告；服务端和权限代码未改，无需重建 dist。
- 主任务已反馈此前真实 UI 验证：目录数量 3/2、展开、路径侧栏、组合筛选 1/5。本轮首次双击与筛选后拖拽位置的浏览器复验仍需主任务执行，不以组件测试替代。

## 2026-10-15 最终 CUA 边界补修：第二击落入新出现的详情栏

- 主任务真实 CUA 复现：1554px 视口，全节点模式无详情，将孤立故事 3 从 (891,710) 拖至 (1390,710) 后原生双击；首击显示详情，第二击落入详情栏，事件不再送到 Canvas，停留在 graph。此前的首次命中 ID 锁定无法处理事件已换接收元素的情况。
- 修复：桌面图谱区域始终预留 20rem 详情列，未选时显示简短“选择页面节点查看路径与关联页面。”提示。选中和关闭只更换右列内容，不切换画布列定义，也不让侧栏侵占已命中的区域。小于 lg 的视口继续单栏，空提示隐藏，详情放在画布之后。保留原双击身份锁定和拖拽抑制，没有引入 window 点击监听。
- 新布局回归先红后绿：选择前后主布局列定义必须不变；详情关闭后仍不变；双栏仅作用于 lg，移动端空提示保持隐藏。原代码在选择后多出 lg 列定义，断言失败；修复后通过。
- 最终客户端图谱 4 文件、41 测试通过；客户端 `tsc --noEmit`、本轮两文件定向 eslint、`git diff --check` 通过。
- 本轮只改 `KnowledgeGraph.tsx`、`KnowledgeGraph.grouped.spec.tsx` 和本报告，未提交、未构建、未进行浏览器操作。按主任务要求没有新增 Playwright 文件。真实跨 aside 命中与小屏验收由主任务 CUA 继续执行。

## 2026-10-15 全量门禁异步画布断言补测

- 主任务全量测试日志 `/tmp/agentwiki-remaining-20261015/full-test-final.log` 中，`KnowledgeGraph.grouped.spec.tsx` 首条用例的目录 DOM 已出现，但画布尚未执行绘制，立即检查 `fillText` 调用得到空数组。此失败属于测试等待时点，应用代码本轮未改。
- 仅修改该测试文件：用 `waitFor` 等待“人物”的实际绘制断言；同文件无匹配清空画布、跨 Space 拖拽坐标断言也等待相应画布调用。跨 Space 用例先等待初始节点绘制再执行拖拽。全部原断言保留，没有固定 sleep、skip 或降低断言。
- 单文件复验：`pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/KnowledgeGraph.grouped.spec.tsx`，1 文件、8 测试通过。
- 全客户端复验：`pnpm --filter @agentwiki/client exec vitest run`，155 文件、2549 测试全部通过，exit 0；日志 `/tmp/task5-client-final.log`，耗时 24.18s。
- 本次测试文件定向 eslint、`git diff --check`：通过。没有构建/清理 dist、提交或暂存，没有重复执行主任务已通过的数据库及服务端阶段；整体分阶段门禁由主任务汇总。
- 主任务最新真实 CUA 回执：将节点拖到画布最右缘后原生双击，已成功导航到“孤立故事 3”（`7767e054-f8ca-40ca-8f19-172a07753fa5`），F1 实际验收通过。此证据来自主任务的 computer use，本子任务未操作 UI，不将组件测试当作浏览器证据。
