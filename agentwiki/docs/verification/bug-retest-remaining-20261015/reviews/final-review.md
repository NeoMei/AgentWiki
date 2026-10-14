# 剩余问题修复：整支独立审查

## 结论

**最终代码审查：PASS。** 基线 `286928c0c36632b2d6554480d45204b853291f1c`，整支首审候选 `cd805aa456638d21ec1c157684224a6d5b5a2eef` 曾发现 2 项 P2；F2 已在 `d5c31e8d`、F1 已在 `9c3e79a4` scoped 复核通过。最终覆盖提交为 `9c3e79a4c69cbf37e4faad43f9ae408e6cf6c83f`，没有尚未处理的代码审查 finding。

以下保留两项原发现与补修证据。此 PASS 是代码审查结论，不能替代主任务的最新整支门禁、真实 UI、生产发布及报告读回。

本次为新的整支 reviewer。已读原计划、constraints、五组实现报告、初审与 scoped 复审；独立读取全部生产差异及相关服务端协议、授权、查询、生命周期代码。CodeGraph 再次返回无索引，按提示使用普通源码工具，没有创建索引。未改产品代码、未操作浏览器或生产、未暂存/提交。三个 0.12.31 package version 的未提交变化仅为元数据，不属于本审查的功能差异。

## F1 [P2] 首次双击右侧节点时，第二击落入新侧栏，导航处理器无法收到事件

- 位置：`apps/client/src/features/knowledge/KnowledgeGraph.tsx:457`、`472-477`；关联 `257-290` 的点击处理和 `508-509` 的条件侧栏。
- 无选中页面时 canvas 占满网格；第一次 click 立即设置 selectedNode，使 grid 增加 20rem 右栏并缩窄 canvas。候选保存首次命中 ID 的补修，只处理第二击仍命中 canvas、但重排后命中别的节点的情况。
- 若首次点击在原 canvas 右侧，第二击的相同屏幕位置已经属于 aside。`onDoubleClick` 只绑定 canvas，因此不会调用保存首击 ID 的导航分支。`useGraphViewport.ts:67-72` 在第一击 pointerup 就释放 capture，不会把随后 aside 上的新 pointerdown 留在 canvas。
- 主任务已提供当前候选的真实 CUA 复现：1554px 宽、全节点视图、无详情，将孤立“故事 3”从 `(891,710)` 拖至 `(1390,710)`，然后 native 双击 `(1390,710)`；页面只出现详情栏，URL 仍停留在 graph。此处是真实 UI 观察由主任务执行，本 reviewer 未自行操作浏览器。
- 建议在双击序列中保持 canvas 命中区域稳定，例如预留侧栏布局或延后会挪走点击目标的布局变化；不要通过全局双击监听让侧栏任意操作误打开页面。补充覆盖“第二击目标元素变为 aside”的回归，并复验普通首击、拖拽后点击/双击、关闭详情与窄屏。

## F2 [P2] 协作 get/join 的真实 `status` 字段仍丢失等待审核状态

- 位置：`apps/server/src/mcp/mcp.service.ts:674-687`，最终回退见 `572-573`。
- `CollaborationJoinRunOutputSchema` 和 `CollaborationGetRunOutputSchema` 的真实输出是顶层 `status: CollaborationRunStatusSchema`（`packages/sync-protocol/src/collaboration.ts:603-611`、`657-662`），不是 `runStatus`。目前协作分支只验证 `artifactStatus/taskStatus/runStatus`，随后通用 status allowlist 又缺少 `draft`、`waiting_review`。
- 因此同一工具返回 running 会记下运行状态，但返回正常的 waiting_review 会得到空摘要，再退化为“响应已返回”。用户仍不能从新增活动日志判断协作是否进入审核等待；这不是历史字段缺失或超长正文回退。
- 已运行从当前源码提取的 `mcpAuditResultSummary` 只读探针，使用真实 get_run DTO 形状和 MCP text JSON 包装，结果为：ready → `{status:"ready"}`；running → `{status:"running"}`；waiting_review → `undefined`；draft → `undefined`。原始内容没有写入日志或持久化。
- 建议仅对 `tool.collaboration_get_run` / `tool.collaboration_join_run` 用已有 `CollaborationRunStatusSchema` 校验 `value.status` 后映射为 `runStatus`；客户端现有 runStatus allowlist 和中英译文已包含全部合法状态。增加实际 registered handler 的 waiting_review 与 draft 回归，保留 leaseToken、waitingReason、任务正文等自由文本排除规则。

## 其余整支核对

| 范围 | 独立核对结果 |
| --- | --- |
| #5 来源页面选择 | 可见结果、数量、同名 canonical path 与精确 ID 选择均落在原查询/OCC流程上；没有另建不受版本保护的提交路径。 |
| #6 草稿恢复与新建 | summary/details 合并保留归属字段；scoped/legacy 指针分开处理；失败保留指针；新运行使旧 mutation/request epoch 失效，未取消或覆盖旧服务端记录。原 billy 数据回放仍不能由同结构测试替代。 |
| #8–#10 编辑交互 | 成功选择只删除匹配 scope/session/全文的单个触发字符；取消/显式加号保留原文。设置与更多菜单 portal 后仍保留直接修改页面选项和原能力校验；visualViewport 边界、Tab/Shift+Tab、null blur、外点及 Escape 处理已核对。 |
| #11–#12 通知与目录 | 成功提示生命周期不删除恢复回执；原 batch/OCC/tree revision 恢复 API 不变；错误独立保留。目录沿 AST offset，新增动态工具栏 scrollMargins，不重新按标题文本猜位置。 |
| #13 图谱 | 新 Folder 查询同授权 Space、仅 live 记录；既有 graph:read / 写入授权和来源投影不变；全节点候选代替首批 pages 请求。手动位置按 Space/模式隔离，边筛选不重建坐标。除 F1 外未发现新增阻塞项。 |
| #7/#14/#15 日志与来源 | 业务目标/关系两端/看板状态/协作 submit 与 repair 摘要仍以受限枚举/计数呈现；F2 为额外漏项。来源诊断从结构化 failure 读取，不猜历史阶段；技术 URL 去掉认证、查询和 fragment，原始异常不展示。 |
| #16/#17 协作列表/名称 | 显示 createdAt 与现有服务端 createdAt/id 倒序签名游标一致；必填提示、错误焦点与默认输入行为不改服务器生命周期。 |
| #18/#19 审核 | 分页查询先限定授权 Space，再全文历史筛选，SQL 参数绑定并转义 LIKE；计数与页 ID 同一语句，固定 status/createdAt/id 顺序。元数据查询有 Page/ChangeSet 同 Space 限制；权限来自当前未锁定/删除的人类 owner，Agent 和非成员 super_admin 不得到审批能力。旧无查询参数 HTTP/MCP 数组合同保留。深链读取、请求序号、scope、access epoch 与拒绝后的清理已核对。 |
| #20 Agent 归档 | 新路由沿 JWT + HumanOnlyGuard 与 owner 限制；事务 owner→Agent 锁序与 live authorization/revoke 一致；状态和审计同事务，归档保留 Grant/Credential，恢复为 paused，普通 PATCH 不能绕过恢复。默认发现排除 archived。 |
| v0.12.29/30 稳定行为 | 直接修改页面回调、保存/OCC路径未被改动；本轮没有改 Space policy、自动发布判定、review mutation 权限、部署脚本、迁移、bundle 门槛或跳过条件。共享 i18n 只合并两语言原本完全相同的九条标签，新增文案在功能模块加载。 |

## 证据与边界

- 审查开始核对固定 cd805aa4 及各 scoped 补修；检查没有误读主检出。结束时原 implementer 已开始改动 `mcp.service.ts` / `collaboration-mcp.spec.ts`，该新补丁不混入本次结论，待单独复核。所有 Git 命令显式 git-dir/work-tree。
- 新鲜 `git diff --check 286928c0 cd805aa4` 退出 0；新鲜纯函数探针确认 F2。F1 的当前版本浏览器复现来自主任务传回的实际操作记录。
- scoped 复审中记录的 232/379/38/21/86/40 等测试总数仅作为已读证据，不冒称本 reviewer 重新执行。当前整支 test:full、typecheck、lint、build、真实 UI、生产发布与正式报告读回由主任务分别执行。
- #1 无产品差异；用户已允许黄金书屋原案无法复现时据实回复。不同 Vault/Space 的真实同步成功不能标成原案修复。
- 完成 F1、F2 的定向补修后，可由本 reviewer 对补丁及相邻边界 scoped 复核，整支其他未变范围无需重复审查。

## F2 scoped 补修复核 — d5c31e8d

**ADDRESSED / PASS。** 补修固定提交 `d5c31e8dd7e092382d651e971df5647471cf3959`，仅 MCP service 与 collaboration handler 测试两文件。

- get_run / join_run 现在按真实顶层 status 使用完整 `CollaborationRunStatusSchema` 核验，并统一写 `runStatus`；不再重复输出通用 status。其他工具继续原有摘要处理，非法状态仍不进入审计。
- 现有 AgentDetail 的 runStatus allowlist 和 bug-operations 双语映射已覆盖 draft/ready/running/waiting_review/paused/completed/failed/cancelled，补修无需改 UI 或增加新的任意字段。
- 独立新鲜执行：`pnpm --filter @agentwiki/server exec jest --runInBand src/mcp/collaboration-mcp.spec.ts --testNamePattern='records top-level run status'`，退出 0；3 个参数化场景通过，每个分别调用 registered join/get handlers，验证两个审计存储得到正确 runStatus 且排除页面正文。6 项因本次 testNamePattern 未选中，不是产品 skip 或完整套件收据。
- 原实现方 41 项套件、typecheck、eslint 作为已读补修收据，本 reviewer 未重复全量；本次范围无新增阻塞项。

## F1 scoped 补修复核 — 9c3e79a4

**ADDRESSED / PASS。** 补修固定提交 `9c3e79a4c69cbf37e4faad43f9ae408e6cf6c83f`，仅 KnowledgeGraph 与分组组件测试两文件。

- 桌面主 grid 现在始终使用 `lg:grid-cols-[minmax(0,1fr)_20rem]`；未选中时右列为提示，选中时只替换为 aside，关闭后再替换回提示。选中状态不再改变 canvas 列定义，首击不会把第二击的同一屏幕位置变成新的 aside 命中区域。
- 小于 lg 继续单列，空提示隐藏，真实详情出现在画布后方；没有全局 double-click 劫持，原首次命中 ID 锁定、拖拽抑制、节点筛选与 Space 隔离保持。
- 独立新鲜执行图谱四文件回归（KnowledgeGraph、KnowledgeGraph.grouped、graphGrouping、graphLabelLayout）：**41/41 通过，exit 0**。新测试覆盖选择前后/关闭后的同一列定义和移动端条件；既有实际点击序列、resize 后目标身份、拖拽、来源筛选、跨 Space 用例全部继续通过。
- `git diff --check 286928c0 9c3e79a4` 新鲜退出 0；两项补修的四个产品/测试文件相对固定提交均无工作区差异。未变的其余整支范围沿首审结论，不重复扩大审查。
- 布局修复后的最右侧原生双击和窄屏实际命中仍由主任务 CUA 验收并单独记录；本 reviewer 不将 jsdom 的布局 class 断言冒称像素/浏览器证明。
