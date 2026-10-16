# Task 1 独立审查

当前结论：**PASS**（修复提交 `ea984a77060dbe326ef2b192e505b7f5ae164336` 复审通过）。以下保留首轮 P1 发现；该项已解决，复审收据见文末。

审查范围：`1c61b3b3..72a3a470`，依据 `/tmp/agentwiki-retest-task-1-brief.md`、对应 review diff 和 `task-1-report.md`。只读检视实现、关联 schema/生成链及已有验证记录；未重跑测试，未改实现。

## 首轮结论

- Spec compliance：**不通过**。#17 必填校验实现符合要求；#2 个人默认单页中文来源识别仍遗漏真实合法数据。
- Code quality：**需修正后复审**。有 1 项 P1，当前候选不可按 Task 1 已完成合入。

## P1：默认单页的真实 `collaboration: null` 被来源判定排除

- 位置：`apps/server/src/collaboration-workflows/run.service.ts:1227`。
- 新条件要求 `definition.collaboration === undefined`；但真实定义 schema 在 `packages/sync-protocol/src/composite-template.ts:73–78` 将 `collaboration` 定义为必填的对象或 `null`。普通个人/Space 单页使用 `collaboration: null`，而 `template-instantiation.service.ts:456` 正是用 `definition.collaboration ?? ordinarySinglePageCollaboration(definition)` 生成默认 workflow。
- 结果：合法普通单页的冻结版本无法进入新增 `single-page` 来源分支；个人/Space 模板又不满足后面的系统归属回退，运行 DTO 仍返回 `systemTemplateSource: null`。客户端按自定义文字保留英文，因此 #2 的实际路径未修复，运行中与历史运行均受影响。
- 现有新增 `run.service.spec.ts:706` 的默认单页用例省略了 `collaboration`，也缺少合法定义的其他必需字段；它只证明不符合实际 schema 的 mock 能通过。这解释了现有绿色日志为何没有发现缺口。
- 建议：按实际无工作流语义接受 `null`，若有必要兼容历史缺字段也可保留 `undefined`；使用经过 `CompositeTemplateDefinitionSchema` 校验的 `collaboration: null` 单页 fixture 覆盖个人/Space、running/completed，并继续断言显式自定义 workflow 不翻译。

## 已核对的其余部分

- `RunStartWizard.tsx:162–192` 一次收集名称和所有必填错误，并按字段显示顺序聚焦；数字 key 不再改变焦点顺序。
- `RunStartWizard.tsx:835–862` 为输入项绑定行内错误和 ARIA；`run-input-validation.ts:41–58` 拦截必填空白，保留 `0`、`false`、可选字段和类型约束；名称创建/更新/展开入口共用 trim 后非空检查。
- 展示来源来自运行引用的冻结版本，无写权限扩大；Agent 名称及明确自定义 workflow 保留路径不变。中英文行内文案齐全。
- 已有 client 164、server 129 通过日志已读取，未重复执行；这些结果属于本次被审查候选，不能覆盖上述未建模的合法 null 定义。

本结论只覆盖本任务候选。隔离 fixture 浏览器回执不是生产或原 Windows 环境关闭证明；修正后需对新 diff 和受影响回归另出回执。

## 2026-10-16 P1 修复复审收据

复审提交：`ea984a77060dbe326ef2b192e505b7f5ae164336`。仅审查该提交的两处服务端文件和任务报告，核对真实 schema、生成链及新增红绿日志；未修改生产代码、未重复执行测试。

- Spec compliance：**PASS**；Code quality：**PASS**。原 P1 **已解决**，未发现本次修复引入的新阻塞项。
- `run.service.ts:1227–1230` 现在接受 `collaboration === null || collaboration === undefined`，同时保留 composite 来源、single_page、恰好一个 page 节点的限制。该判断与 `CompositeTemplateDefinitionSchema` 的 nullable 存储值，以及 `selectCompositeCollaboration()` 的 `??` 默认生成语义一致。
- `run.service.spec.ts:37–47,715–729` 使用完整且经 `CompositeTemplateDefinitionSchema.parse()` 验证的单页定义，覆盖 personal/space × running/completed；因此新回归实际包含原先漏掉的真实 null 路径。历史缺字段另有兼容用例（731–740）。
- `run.service.spec.ts:743–766` 对显式自定义 workflow 使用与默认生成器完全相同的英文名称/目标/Todo，并仍要求来源为 null；页面组与未知定义也被排除。实现没有按文字相等猜测来源，没有扩大到自定义工作流。
- 来源仍从运行引用的冻结版本读取，未改数据库原文、客户端翻译表、Agent 名称展示、权限检查或必填输入语义；原 #17 审查结论保持有效。
- 已读取新增红日志：4 failed / 78 passed，失败对应合法 null 定义的四种组合；新绿日志：5 suites / 132 passed。类型和定向 lint 的原执行记录由实现者提供，本次仅读取记录，未把首轮 129 项结果当成修复后证据。

Task 1 候选可进入主任务最终整分支门禁。该 PASS 不表示已发布、已部署或原生产/Windows 环境反馈已关闭。
