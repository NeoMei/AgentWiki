# Task 2 独立审查

审查范围：`72a3a470..d15d6f4a`，依据 `/tmp/agentwiki-retest-task-2-brief.md`、对应 review diff 和 `task-2-report.md`。只读检视实现、浏览器测试及既有验证记录；未重跑测试，未改实现。

## 结论

- Spec compliance：**通过**。
- Code quality：**通过**。未发现有证据、需要阻塞集成的 P0/P1/P2 问题。

## 核对依据

- `MarkdownWorkspace.tsx:102–111,1104–1123` 从可滚动祖先和工具栏计算共同边界，点击使用 `yMargin: 0`，消除默认 margin 与高亮边界不一致。
- `MarkdownWorkspace.tsx:727–754` 只接收正文所属滚动事件，以 `lineBlockAtHeight(...).from` 查询 CodeMirror 高度图，再按源偏移映射目录；不会依赖长文中已虚拟化标题的 DOM 坐标，也不依赖标题文字唯一。
- `MarkdownWorkspace.tsx:558–573,733–761` 点击锚点只在目标位置稳定或布局高度变化时保留，并记录无 scroll 事件时的实际位置。滚轮、触摸、指针、滚动键、实际坐标位移会释放锚点；正文修改、选区移动、resize 亦有释放路径，未发现永久锁定高亮的实现。
- 点击仅更新选区和滚动 effect，没有改写 Markdown；目录面板滚动不会进入正文的 active heading 更新。
- `e2e/editor-outline.spec.ts` 的真实 CodeMirror fixture 覆盖 1440/390px、虚拟化长段、软折行、重复标题、目录自身滚动、无输入手势的直接 scrollTop 变化、末尾折叠子标题、短文末标题及原文不变。已有报告记录同组测试从 4 failed 到 4 passed，并保留测试产物路径；另有 151 项相关组件回归、类型和 lint 记录。

现有验证足以支持该范围候选进入整分支集成。此回执不等于原生产页面或 Windows 环境回验；发布、原案复测和最终关闭仍由主任务单独确认。
