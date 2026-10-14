# Task 5 scoped rereview — cd805aa4

结论：**PASS**。`35be76ca` 初审的两项 P2 均已在 `cd805aa456638d21ec1c157684224a6d5b5a2eef` 修复；此次范围内未发现需要阻断集成的新问题。

## 复核结果

1. **首次点击引起侧栏 resize 后，双击不打开邻页：通过。** `KnowledgeGraph.tsx:256–293` 在 click detail <= 1 时保存页面 ID，后续同一序列的 click detail > 1 不重新命中或切换选择；dblclick 使用保存的 ID，并确认仍属于当前筛选节点。分组与空白显式记录非页面目标，拖拽抑制仍先于导航判断。新增回归执行实际 mouse down/up/click(1) → ResizeObserver 1000→664 → mouse down/up/click(2)/dblclick，确认第二次坐标已落到 p2 内时仍导航 p1。
2. **来源筛选保留手动坐标：通过。** `KnowledgeGraph.tsx:88–126` 将节点初始化与边投影分开；无 relation 过滤时来源切换不会重建节点。发生节点隐藏/恢复时，按 ID 回填实际拖拽记录；grouped/pages 两套记录互相隔离。`graphGrouping.ts:32–72` 拆分节点布局与边投影，保留原折叠端点投影语义。新增两种模式的回归均覆盖 (+80,+60) 拖拽、来源开关、组合 relation 筛选隐藏全部节点后恢复。
3. **新 Space 隔离：通过。** Space 变化清除坐标 Map 与首次点击目标，旧异步图谱回执仍经 requestVersion 拒绝。新增用例故意让两个 Space 使用同一 `group:ungrouped` ID，确认旧 Space 的 (230,150) 不覆盖新 Space 的 (150,90)。新提交未修改服务端或权限路径。

## 独立验证

- 确认复审的 4 个文件相对 `cd805aa4` 无工作区差异；其他正在进行的版本/文档改动未纳入本次复审。
- 2026-10-15 02:34:58 +08:00 执行：
  `pnpm --filter @agentwiki/client exec vitest run src/features/knowledge/KnowledgeGraph.spec.tsx src/features/knowledge/KnowledgeGraph.grouped.spec.tsx src/features/knowledge/graphGrouping.spec.ts src/features/knowledge/graphLabelLayout.spec.ts`
- 结果：**4 个文件、40 条测试通过，exit 0**。已有缩放、平移、节点拖动、鼠标/Pointer、拖拽后双击抑制、延迟兼容事件测试继续通过。

## 边界

本轮仅审查上述两项 P2 的补修及直接相关隔离边界，读取固定提交差异、相邻 hook/数据流与测试，并重跑定向组件/纯逻辑测试；未修改实现、未操作 UI 或生产、未提交。CodeGraph 已尝试，当前索引不可用后按工具提示读取源码。该 PASS 是代码复审结论；本轮没有浏览器验收或发布回执，主任务仍需完成已安排的真实 UI 复验。

额外 UI 验收点：新增 ResizeObserver 用例固定将第二击派发给 canvas，未覆盖第一次点击原画布最右侧、侧栏出现后同一屏幕位置已落在 aside 的浏览器命中边界。请主任务在真实 UI 上选择最右侧节点双击，确认第二击仍可完成预期导航；该项在本轮只发现测试覆盖缺口，未操作 UI 复现，不作为已确认代码缺陷报告。
