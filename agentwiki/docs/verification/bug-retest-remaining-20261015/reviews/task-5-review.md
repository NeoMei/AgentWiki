# Task 5 independent review — 35be76ca

规格结论：未通过。真实文件夹、全量节点、搜索、类型筛选及详情侧栏均已实现，但“保留现有图谱导航”存在下述两处回归。

质量结论：需修改，2 项 P2；服务端新增 folders 未发现越权或跨 Space 查询问题。

## Findings

1. **P2 — 首次双击可能打开另一页面。** `KnowledgeGraph.tsx:427` 只在 `selectedNode` 非空时加入 20rem 侧栏；第一次 click 在 `247` 行选中节点后，Canvas 宽度随之改变，`useGraphViewport.ts:123–124` 的 ResizeObserver 立即 fit。第二次 click / doubleClick 在 `234`、`256–259` 行重新按已移动的坐标命中，因而不是第一次点中的页面。可复现几何：一个已展开文件夹、两个页面；Canvas 1000px 缩至 664px，p1 原屏幕位置 (425,298)，fit 后 p2 位于 (407,298)，同一位置第二击命中 p2，随后跳转 p2。该坐标结果按固定提交的投影、fit 和 hit 算法单独计算确认；没有操作浏览器。应让选择侧栏不移动双击目标（预留侧栏、保持视图或锁定双击目标），并补“真实双 click 序列 + 选择引起 ResizeObserver”的回归。

2. **P2 — 来源筛选会丢失拖拽布局。** `KnowledgeGraph.tsx:96–100` 的 projection 同时依赖 `visibleEdges`，每次来源开关都会重新从未移动的 `nodes` 或默认分组坐标生成节点，并用 `setGraphNodes(projection.nodes)` 全量覆盖；拖动则仅修改 `graphNodes`（`101` 行传入 hook，`useGraphViewport.ts:98` 更新）。因此在全部页面或分组模式拖开节点后，切换“手动”等来源开关，位置立即回到初始布局；如果此前已平移到拖动区域，节点还可能离开当前可见范围。父提交直接更新 `nodes`，筛选来源不会重置坐标。应按稳定节点 ID 保留已存在的布局，将边筛选与节点初始化分开，补“拖动后筛选来源”的回归。

## 已核对的边界

- folders 查询限制 `spaceId` 与 `deletedAt: null`，只投影 id/name/path/parentId；空空间仍返回空目录。REST 与 MCP 入口原有 `graph:read` 授权保持，关系与来源投影未变。
- 分组以真实 folderId 为准，保留空目录、未分组与失效引用，数量为直接包含页面；搜索和建立关系候选复用全量 graph nodes，没有首批分页遗漏。
- 标题/路径搜索、relation 与 origin 组合过滤、唯一关联页面计数及打开页面入口代码路径一致；旧 Space 图谱读取回执由 requestVersion 丢弃。
- 新文案中英双语且独立模块；未修改共享 messages。

审查依据：task-5 brief、constraints、原报告 #13、固定提交源码与父提交差异、实现报告和现有测试覆盖。未重跑已有测试，未改实现代码，未操作 UI、生产或子代理。现有测试回执不替代修复后的浏览器导航验收。
