# Task 2 scoped 复审

**结论：PASS。F1、F2 均 ADDRESSED；本轮补修未发现新增阻塞问题。**

- 范围：`58b331a7` / `task-2-fix-review.diff`，并核对 `task-2-review-fix-receipt.md`；已读 brief、原 review、report 和 constraints。当前检查树 `4e8fc153` 中对应生产文件无后续差异；不扩大到原有未改代码。
- F1 **ADDRESSED**：菜单水平边界加入 visualViewport.offsetLeft，垂直边界使用 offsetTop/height，实际高度受 maxHeight 限制；visualViewport 独立 scroll/resize 会关闭菜单，清理使用同一 viewport 实例。新增非零偏移和事件用例覆盖原可确定失败路径。
- F2 **ADDRESSED**：设置和更多菜单均处理 Tab/Shift+Tab，关闭后按 trigger 附近的可用控件续接；更多菜单阻止 portal 事件重复冒泡。两处 null relatedTarget 与外部焦点均关闭且不强制抢回 trigger，禁用菜单项时 trigger 上的 Tab 也关闭。核对实际设置弹层只有一个 select、工具栏相邻操作及 helper 的禁用/隐藏过滤；原 Escape 与外点路径仍保持。

证据边界：已读取 `/tmp/task2-review-final2.log` 的 6 文件、379/379 通过收据；tsc/lint 采用实现修复收据，本复审未重复运行。CodeGraph 无可用索引后采用静态源码/调用点核对。未改产品代码、操作 UI/生产或创建子代理；此结论不代替真实键盘、缩放视口和生产验收。
