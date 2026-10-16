# Task 3 独立审查 — 图谱删除关系入口

审查日期：2026-10-16。候选：`d15d6f4a..f0abd207`。审查依据：`/tmp/agentwiki-retest-task-3-brief.md`、`/tmp/agentwiki-retest-task-3-review.diff`、候选提交的逐行源码及 `task-3-report.md`。

## 结论

- **Spec verdict：PASS（代码层需求一致性）**。
- **Quality verdict：PASS**。
- **Findings：无。** 未发现本任务 diff 引入、需要修复的缺陷。
- **浏览器验收门槛独立保留**：主代理已转述英文 Chrome 中从 4 条关联删除指定 1 条后变为 3 条，38 个页面保留，并真实触发浏览器确认框；本审查未独立操作浏览器，390px 与完整桌面 / 手机中英文矩阵仍以主代理的后续验收回执为准。上述 PASS 不代表部署或原反馈已上线关闭。

## 逐项依据

以下行号均对应 `f0abd207`；路径相对 `agentwiki/`。

| 检查项 | 结论与证据 |
| --- | --- |
| 常显文字入口 | `apps/client/src/features/knowledge/KnowledgeGraph.tsx:331-341` 将每条关系放入常显 `ul/li`，文字按钮位于折叠证据 `details` 之前；每条都有“删除关系 / Delete relation”，不会随证据默认关闭而隐藏。 |
| 中英文与可访问名称 | `KnowledgeGraph.tsx:334-339` 使用实际源 / 目标节点、关系类型与本地化来源生成 `aria-label`；缺失节点标题回退 ID。垃圾桶图标设为 `aria-hidden`。`apps/client/src/i18n/bug-graph-messages.ts:19-21,63-65` 提供对应中英文文案。可访问名称包含按钮可见文字。 |
| 双向及多条关系 | `KnowledgeGraph.tsx:265-268,332-339` 保留每一条 edge，以 `edge.id` 为列表 key 和删除参数；方向依据实际 `edge.source`，可访问名称同样使用真实方向。未将页面对作为删除键，也未按方向合并或批量删除。 |
| 确认与取消 | `KnowledgeGraph.tsx:255-260` 保留既有 `window.confirm`，取消直接返回；只有确认后才发送 `/knowledge/relations/{relationId}`。 |
| 权限及关系类型语义 | API 路径和调用方式保持不变，未修改后端鉴权、权限上下文或来源规则；自动关系与其他来源沿用既有操作资格。未新增“自动关系不可删除”等政策。 |
| 删除失败保留信息 | `KnowledgeGraph.tsx:86,188,258-260,340` 将删除 API 错误局部保存至对应关系，并通过已有 `apiErrorMessage` 本地化；拒绝时不清空 nodes / edges / selectedNode，不重新取图覆盖证据。切换空间清理错误，旧空间回执保留原有隔离检查。 |
| 不误删页面 | `KnowledgeGraph.tsx:259,339` 仅调用关系端点并传选中 edge ID；本任务未引入页面删除调用。新增回归明确检查两页仍存在、其他两条关系仍保留。 |
| 窄栏样式 | `apps/client/src/features/knowledge/KnowledgeGraph.css:84-96` 为标题提供换行和收缩规则，删除按钮以独立块后的 inline-flex 显示、最小高度 32px；原侧栏窄屏布局在 `:105-106` 保留。静态 CSS 审阅不替代 390px Chrome 检查。 |
| 证据和来源详情 | `KnowledgeGraph.tsx:341-350` 保留原始来源方式、置信度、生成者、审批、来源版本 / commit 和证据片段，仅将折叠层级移到每条关系下。 |

## 测试证据审阅

- 阅读 `apps/client/src/features/knowledge/KnowledgeGraph.grouped.spec.tsx:42-110`：中英文默认可见、方向 / 类型 / 来源、取消不写入、反向指定 ID 删除、页面和其他关系保留、403 / 网络失败后保留上下文及可展开证据均有针对性断言。
- 阅读 `/tmp/agentwiki-task3-green.log`：记录 2 个测试文件、43 项通过。实现报告另外记录 TypeScript、定向 ESLint、diff check 通过；本审查未重跑这些命令。
- 仅审查 Task 3 的四个代码 / 测试文件及其报告，未纳入其他进行中的修改；未修改生产代码、未运行测试、未派生代理。

## 保留边界

删除成功后的重新获取图谱仍使用既有 `fetchGraph`：若该刷新失败，仍显示全局加载错误（`KnowledgeGraph.tsx:165-178,259,277`）。这是原流程且实现报告已明确说明，不列为此 diff 新增缺陷；本次失败保留改善针对删除 API 本身拒绝 / 网络失败。
