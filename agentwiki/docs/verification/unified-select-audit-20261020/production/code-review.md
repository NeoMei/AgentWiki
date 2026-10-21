# 统一选择器最终源码复审

结论：**未发现本次范围内的确认阻塞问题。** 当前产品中的 56 处原生下拉选择入口已统一，未发现同类控件绕过共享实现。

- 时间：2026-10-20（Asia/Shanghai）。
- 工作树：`/Users/neomei/.codex/worktrees/template-preview-custom/AgentWiki `（尾空格）。
- 基线：`2f653b97346537fbb4163a7bddc546d471153727`。
- 审查结束读取 HEAD：`fb61b3cc55558b8e71aa05ad15a33aafa40b8f51`。
- 方法：读取整批 TSX/CSS/ESLint 差异、重新运行 TypeScript AST 前后对照、检查产品所有 CSS 焦点/选择器规则及 custom-popup-candidates；读取现有本地浏览器回执作为补充，不将其称为本审查亲自执行的线上验收。未修改源码，未运行 build。

## 迁移行为

独立生成 `final-review-ast.json`：28 文件、56 个控件；除 className 外，全部 attributes 与 children 表达式逐字一致，差异 0。包括 value/defaultValue、事件处理器、disabled/required、id/aria、option 值与禁用条件。NativeSelect 只返回一个原生 select，forwardRef 指向真实 DOM；既有 label、form、querySelector('select') 与弹层焦点机制继续成立。

组件 className 合并不会覆盖 props，data/aria/name/form/required 等属性继续透传。multiple 或 size > 1 切换 listbox 样式，保留原生 size，移除单选箭头并解除固定高度。现有业务没有 multiple/size 实例。

## 共享外观与可访问性

- 单一 CSS 持有白底、14px 字号、8px 圆角、32px 桌面高度、移动端最小 44px、12/32px 左右留白和 SVG 箭头；未引入额外依赖或 wrapper。
- 指针焦点去除默认粗 outline；键盘 focus-visible 仍提供中性深边框及轻 ring。`prefers-reduced-motion` 移除过渡。
- `:disabled` 同时覆盖自身 disabled 与禁用 fieldset 后代；保持清晰文字/浅灰底，阻止 hover 外观。原生禁用交互仍由浏览器承担。
- `[aria-invalid=true]` 与 `:user-invalid` 使用错误边框；没有在用户交互之前给所有 required 空值预先染红，键盘焦点 ring 仍存在。
- forced-colors 恢复 `appearance:auto` 并移除背景 SVG，使用系统颜色、GrayText 禁用状态、Highlight 焦点 outline；不会同时显示系统箭头和自绘箭头。现有本地浏览器回执确认 1440/390 下 forced-colors 的 appearance:auto、background:none、2px 可见焦点，以及禁用控件外观。

## CSS 覆盖排查

产品 CSS 所有剩余 select/aw-select 规则均为 display/width/flex/margin/min-width/max-width/text-overflow 等布局。模板预览、模板管理、模板来源、图谱、Agent 设置、协作角色、表格工具、任务看板的旧 padding/font/background/border/focus 定义均已移除或排除共享组件。

角色分配的 width:0 + flex:1 1 160px 仍直接作用于真实 select；图谱无障碍浏览 max-width160、模板来源144/手机100%、模板正文切页100%等约束保留。看板跳转控件宽度80用于容纳统一箭头区，移动高度继续由共享44px规则提供。没有用 !important 覆盖业务 CSS。

额外检查 `.collaboration-settings-input :focus-visible`：该容器当前只放 input/textarea，与本次 56 个 NativeSelect 没有祖先关系，不构成当前覆盖。

## 自制菜单与旁路检查

`custom-popup-candidates.json` 的候选包含大量 role=status/alert，过滤到菜单/展开/弹层后复核结果：

- Navbar、树节点菜单、页面更多操作、斜杠命令菜单承担导航或动作，不是单值表单选择。
- DocumentTools 页面链接、AgentReferencePicker 引用搜索承担搜索、动态授权结果、插入/多引用操作，保留 dialog 和专用键盘行为合理。
- Agent 设置、图谱关系详情的弹层内原生 select 已统一；弹层自身不是旁路选择器。
- 会话历史、文章目录、页面信息、目录抽屉、选区笔记及其余 details 是历史/导航/信息/编辑面板，无本次默认平台箭头问题的等价入口。
- 当前产品源码裸 `<select>` 仅共享组件内部一处；未发现手写 role=combobox/listbox、datalist 或 createElement('select') 创建路径。

## 防回归范围与证据

ESLint 对 `apps/client/src/**/*.{jsx,tsx}` 禁止 JSX 原生 select，仅豁免精确共享文件、spec/test 文件和 __tests__。5 项实际 ESLint 输入测试覆盖业务负例、共享消费正例、内部实现与测试豁免；CLI stdin 负例另确认 exit 1，提示使用 NativeSelect。该测试按既有 runtime harness 的 `*.test.mjs` 规则自动纳入。

新增模板 E2E 实际检查 appearance、SVG、圆角、高度、字号、Tab 焦点、轻 ring、切页/放大/手机与 forced-colors，覆盖原缺陷发生点。标签 lint 不声称拦截任意未来 React.createElement 或 CSS 人为覆写；当前源码未存在该旁路，样式视觉回归另由真实浏览器断言承担。此限制不构成当前阻塞。

## 证据边界

本审查执行的是源码/AST/现存回执复核，不是生产发布或线上视觉验收。父任务报告的全量 client、lint、typecheck、build 通过，仍应与其原日志、后续冻结提交及线上回执分别绑定。此次未新增确认问题。
