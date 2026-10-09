# 来源复核实际验收

**来源复核的本地实现、实际主线和边界验收通过；两项 UI 问题已修复并复验。冻结八题检索质量单独评分，不能由本报告代替。**

首轮固定 `bf7787b613757e7cc0a8ffaa2b47932456175c08`；UI 修复为 `3b8c918ff636f3bfc708f8d499a2d4cc51a54d10`，随后以新隔离环境实际复验。以下保留首轮事实和原失败，不回填覆盖。

证据根目录：`/tmp/agentwiki-knowledge-20261007/source-freshness-evidence-wS48i4`。同目录 JSON 提供各阶段最小字段、文件 SHA-256、实际计数与证据索引，不复制原始 DTO、正文、登录信息或凭据。

## 固定身份与主线

| 项目 | 固定值 |
| --- | --- |
| 产品提交 | `bf7787b613757e7cc0a8ffaa2b47932456175c08` |
| source SHA-256 | `d3e2a24f56ebaf5c03a0963ed56bd26a84c7e514ed3ad6a10fadee446c60c141` |
| build SHA-256 | `f9c2599d29cced77613391390b7267cf4a9ed61b3e3c25c5c76920aea2f92315` |
| harness SHA-256 | `04a8a77c5c81705da7275df4e0e3072e6b609828386576349ccdc5a3c0b209d6` |
| 三问 SHA-256 | `2c1ed5c2a92e6d3d6fad99cdfd7e207f29c7d97a56f6c125db16bbc86684b5be` |

实际链路为明确确认的合成 OKF → 真实 HTTP intake → 真实 ingestion worker → 实际 UI 逐项决定与发布 → REST/MCP/两个独立模型消费者读取。核心 Source、Version、Run、ChangeSet、Approval、Page 未用数据库 seed 替代。OKF 编译是产品确定性 pipeline，不是模型 fixture。

| 阶段 | 实际结果 | 回执 |
| --- | --- | --- |
| v1 待审与发布 | UI 展开两项、接受、正式发布；分派 24 小时、保留 7 天，均 current/v1/gen1 | `root-v1-pages.json`；`ui/v1-pending-1280.png`、`ui/v1-published-1280.png` |
| v2 收到、尚未审 | 正式两页正文仍为 v1，均 needs_review；当前来源 v2/gen2，已复核依据仍 v1/gen1 | `root-v2-before-pages.json`；`ui/v2-needs-review-1280.png` |
| v2 部分决定 | 分派 accepted、保留 rejected；决定本身不改正式正文 | `root-v2-decisions-before-publish.json`；`ui/v2-partial-decisions-1600.png` |
| 部分发布 | 分派 48 小时/current，保留仍 7 天/needs_review | `root-v2-partial-pages.json` |
| 新 Run 补齐 | 通过当前 Source 的公开 new-run 接口生成新候选；UI 接受发布剩余项，最终 48 小时/14 天，均 v2/gen2/current | `root-v2-after-pages.json`；`ui/v2-fully-published-1600.png` |
| 历史依据 | 两页保留 v1 historical 与 v2 published_basis；来源版本与代次分别标识 | `ui/v2-historical-evidence-1600.png`；MCP resource 回执 |

未以 retry 一个 completed Run 替代补齐流程。`current` 表示页面复核记录与已接收来源对齐，不表示事实绝对正确；初始 provenance 审批也不单独充当最新变更审批证明。

## 原始 REST 与真实 MCP

原始 REST 使用独立 checker 直接读取 JSON，未经过 harness.sanitize。三个主线检查依次为：

| 阶段 | 结果 | 报告目录 |
| --- | --- | --- |
| v2-before | 11/11 | `raw-source-surfaces-f2cdbf7b-655b-439e-a100-1dcc835f312d` |
| v2-partial | 11/11 | `raw-source-surfaces-440d0f56-5839-446c-8a2b-3f3e1ad18407` |
| v2-after | 12/12 | `raw-source-surfaces-63dfc678-3ba9-46c3-970d-082fd781d6fe` |

覆盖 Page 单页/list/hierarchy/search、graph 节点、Review list/detail 及受保护来源/Evidence/provenance 的实际容器结构。三个阶段 graphEdges 均为 0，不能宣称真实关系边 Evidence 已验收。原 checker 的 9 pass/2 fail 原报告保留，见后文夹具错误。

原 persistent reader a 在授权操作窗口读 main 两页、list、分派 search、graph 和 source 成功；搜索不是两标题的穷尽召回测试。撤销 a 后，其原 gateway 返回 `REMOTE_AUTH_REQUIRED`，独立 b 原 gateway 仍能读取 main Page。操作发生于模型结束之后，不能算入模型预算或错误率。

page resource 有两个必须区分的结果：

- 自有短命 **gateway stdio** 客户端实际返回 `-32601`，该方法不支持的事实保留，不能标通过。
- 既有服务器 **`/api/mcp` Streamable HTTP** SDK 正常初始化，再分别 `resources/read` 两个实际 Page URI，均 HTTP 200；正文哈希、sourceStatus 和最小 Evidence 检查通过。此为独立 server-resource 验收，不修饰 gateway 结果。

详见 `authorization-acceptance-report.md`、`mcp-authorization/report.json`、`mcp-authorization/server-resource-report.json`。

## 两场独立真实消费者

同一固定产品、相同中立三问与通用技能、显式 Space、20-call 预算。A/B 使用不同身份、持久 MCP 会话与 CLI thread，未读取 fixture、rubric、state 正文或另一场答案。独立评分不创造合成总分，也不重新评分既有八题检索实验。

| 指标 | A：v2 未复核 | B：补齐发布后 |
| --- | --- | --- |
| 独立阶段评分 | 通过 | 通过 |
| 两项事实/逐项依据 | 2/2；2/2 | 2/2；2/2 |
| 实际回答 | 历史正式 24 小时/7 天，明确来源已变、当前待复核，不猜新正文 | 48 小时/14 天，v2/gen2/current；可追溯 v1 历史 |
| calls / 预算 | 8/20，另 1 discovery | 9/20，另 1 discovery |
| MCP 错误 | 0 | 0 |
| actual-call 响应字节 | 18,791 | 17,394 |
| SDK 累计耗时 | 174 ms | 182 ms |
| CLI 端到端 | 62.443 s | 63.481 s |

两场请求均为 `gpt-6-astra/high`；CLI 没有披露 server-resolved model，不声称路由已验证。token 原字段保留在 JSON；缓存/推理子字段不重复相加构造成成本。两场 stderr 各保留 11 条 rollout fallback WARN 与 1 条 snapshot NotFound WARN，不能写成 stderr 完全干净。

独立评分的小限制保留：A 的“历史已发布、当前待复核”限定主要出现在 q2，且把代次写成“代数”；B 未读取 Review 队列，“没有单独列出待审候选”仅限工具观察，不能证明全 Space 没有待审项。B 三次搜索成功但空返回，后续 list/get 支持答案，不据此宣称召回改善。两场是本例行为证据，不推导大样本正确率或成本增益。

评分原件：`/tmp/agentwiki-knowledge-20261007/source-before-review/a/independent-score.md`、`/tmp/agentwiki-knowledge-20261007/source-after-review/b/independent-score.md`。评分引用的临时 trace 原目录已随清理移除；harness 在证据根保留 trace-a/b，模型统计仍必须按各自时间窗口截取，排除后续 operator 调用。

## 已执行边界

| 场景 | 实际证据与结论 |
| --- | --- |
| intake 幂等 | A/K1→A/K2 noop→B/K3→重放 A/K2，回原 noop/runId=null，head 保持 B/gen2；同 key 异内容拒绝。`root-superseded.json`、`root-operator-http.jsonl` |
| approved B 后收到 C | UI 发布 B 返回 409 `SOURCE_VERSION_CONFLICT`；B 仍 approved、原 1 条 Approval 保留、正式正文不变。不能要求已有审批数为零。`root-superseded.json` |
| A→B→A | SourceVersionId 可复用而代次递增。初次旧 A create 候选先命中 `CONTENT_TREE_CONFLICT`，不算 generation guard 的独立证明。`root-aba-old-a-precondition.json` |
| 同版本 gen3→gen5 | 后补 update 候选实验固定同一 SourceVersionId，旧 Run gen3 与新 head gen5；真实发布返回 409 `SOURCE_VERSION_CONFLICT`。`root-aba-generation.json` |
| 人工改动与候选冲突 | 生成候选后改正式页，发布返回 `CHANGESET_CONFLICT`，pagesUnchanged=true、Approvals=0。`root-human-conflict.json` |
| 人工正文与恢复 | 真正文变更清已复核代次，needs_review/page_changed；同正文和仅标题保留 gen3。真实 PageVersion 恢复后仍清代次、needs_review，不能把恢复当作重新复核。`root-page-edit-restore.json` |
| 精确 ChangeSet revert | 页记录从 gen6 恢复 before 的 gen5；head 仍相同 SourceVersion/gen6，页面 needs_review/source_changed。`root-changeset-revert.json` |
| archive/activate | 归档后 unavailable，仍保留有权历史 Evidence；新 Run 被拒、发布 `SOURCE_VERSION_CONFLICT`。恢复 active 不增 gen6，再发布成为 current。`root-archive-activate.json` |
| 缺确认 upload | 真实 HTTP 400 `SYNC_CONFIRMATION_REQUIRED`，sourcesUnchanged=true。不是 CLI hash 拒绝冒充产品接口负例。`root-unconfirmed-upload.json` |

受控迟到 worker race **只由 Task1 的 protected 实际 PostgreSQL 服务级并发测试证明**，没有在本轮真实 worker/UI runtime 上 kill/restart 验证；harness liveness 不允许如此冒充继续运行。该 DB 证据还包含手动 reserved、search/graph stub 的边界，不能扩写为实际队列竞态覆盖。

## pages-only 授权夹具

明确标注为隔离授权 fixture，**不是公开 UI 的 scope 管理功能**。核对随机 schema、owner、Space 归属及零既有有效 PAT 后，经真实公开 POST 创建新 PAT；只在本次 schema 中，以新 token hash+owner 唯一定位该 credential，将 scopes 调整为 `pages:read`。没有 seed 来源或页面。原 state 字节不变，只生成私有副本供 checker。

原始 checker **21/21**：两 main Page 与无来源页正文哈希保留，来源 ID/Evidence/provenance 按权限脱敏。Source list/get、Run list/get、sync-state 五项均 403 `AUTH_SCOPE_REQUIRED`。结束前再次精确核对仅该新 PAT，经公开 DELETE 撤销，数据库读回 revokedAt；私有副本删除、Prisma 断开。不把本例同 Space 限 scope 结果推为完整跨 Space 隔离证明。

## 实际布局与首轮 UI 发现

长文、目录、页面信息和宽表分别有 1280、1600、390 截图。`root-layout.json` 测得：

| 视口 | 表容器宽 / 内容宽 | 实际 scrollLeft | 页面宽 / scrollWidth |
| --- | --- | --- | --- |
| 1280 | 952 / 1537 | 585 | 1280 / 1280 |
| 1600 | 976 / 1537 | 561 | 1600 / 1600 |
| 390 | 358 / 1537 | 1179 | 390 / 390 |

宽表能够横滚、整页未横向溢出。对应 `ui/long-wide-table-*.png`、`ui/long-toc-*.png`、`ui/long-status-info-*.png`。这些测量不能代替待修语义问题的复验。

1. **UI1：已发布 Review 仍说“候选输入与当前已接收来源一致；仍需人工审核。”** 与已发布/可回滚状态矛盾。原截图 `ui/v1-published-1280.png`、`ui/v2-fully-published-1600.png`。拟改为全状态通用“该变更的固定输入与当前已接收来源一致；这不代表内容必然正确。”及“变更固定版本”，仍区分变更输入与 Page 依据。
2. **来源冲突错误提示过泛。** 实际 guard 返回 `SOURCE_VERSION_CONFLICT` 正确，但 UI 未明确说明来源已变化和重新生成路径。原冲突截图保留；待修复候选实际复验。

上述两项是首轮真实 UI 问题，已在后续修复复验关闭。未将初次定位失败、checker 缺陷或后端正确拒绝算作产品失败。

## 操作与夹具错误保留

- checker CLI 用 lexical path 比较，macOS `/tmp→/private/tmp` 导致 exit0 且无 HTTP；改 canonical-path，真实缺参/软链接子进程覆盖。
- checker 错把 Search wrapper 当 Page，原报告 9 pass/2 fail (`PAGE_COLLECTION`) 保留；严格校验 wrapper 后 unwrap `.page`，并未放宽来源白名单。合并修复纯测试 14/14，随后才有三次实际成功报告。
- UI locator 不够精确导致 timeout，调整定位后继续；不假装初次定位成功。
- ChangeSet revert 初次对整个 Source DTO 做相等比较过宽：嵌套 Run.changeSet 从 published→reverted 本就应变，后来仅比较 head 字段。原 operatorNote 保留。
- 错误 route 的 404、标题请求缺 tree 前置条件的 400 属操作契约错误；不代表正确接口失败。404/locator 细节来自 root 操作汇总，不补造请求时间或 URL。
- 初次旧 A create 被 tree guard 提前拒绝，另做 gen3→5 实验后才证明代次检查。
- 授权脚本首次 EEXIST 在发请求前失败，随后复用自有证据目录。gateway resource `-32601` 作为协议边界单独保留，未悄悄改记为 server-resource 成功。

checker 修复说明位于 `/tmp/agentwiki-knowledge-20261007/check-source-cli-search-fix-report.md`；旧 hash、RED/GREEN、原失败报告均保留。模型 WARN 与非缺陷空搜索结果也未删除。

## 清理与验收范围

`cleanup.json` 为 **CLEANED**，databaseCleaned、protectedInventoryVerified、resourcesRemoved 均 true；a/b gateway 退出、IPC 删除、pendingCalls=0。`root-cleanup-verification.json` 外部核验为 **VERIFIED**：全部登记 PID 已退出、API/Web 端口关闭、随机 schema 与 state 不存在、自有临时父目录删除；public inventory digest 仍为 `6191ee0d4c7a10c831beec7d159577e65eba7ba68ae2fcbf6b21e2758c785ea6`。

两项 UI 修复及复验证据见下文。没有部署、推送、合并或生产迁移；ACP 仍仅接口定义。检索八题的引用质量与本来源闭环分别报告。

## UI 修复和实际复验

`3b8c918f` 仅修改 Review 文案、来源冲突提示和对应组件测试；独立 scoped review Compliant/Approved。47 项组件测试及客户端类型/构建通过，initial JS 549014/550000，未改预算或后端/来源/权限/发布逻辑。

新运行 `source-freshness-evidence-lHQ2wQ` 实际确认已发布、已拒绝记录提示中性，以及过期已批准候选发布的 409 与重新生成指引（1280/390）。独立视觉审查指出其回滚截图过早：脚本误等了常驻“已回滚”筛选标签，截图仍在 published 刷新状态。原自动 PASSED 及截图保留，**不作回滚完成态视觉证明**。

第三运行 `source-freshness-evidence-Oy3YOx` 保持同一产品/构建，修正的操作者等待条件为回滚 action 消失并实际 GET 目标 ChangeSet.status=reverted。真实流程再验证 v1 发布、v2 仅批准、v3 supersede、过期发布 409 且正文无变化、v3 发布后回滚、重新生成后拒绝。五张截图记录中性 published/reverted/rejected 与两个宽度的错误指引；`final-ui/result.json`、`requests.json`、`http.jsonl` 保存真实响应。本次回滚截图明确显示已回滚与两个 reverted item，无回滚 action。

三轮 source runtime 均 CLEANED；各有 root 外部 PID/端口/schema/state/临时父目录清理核验。公共库存 digest 始终相同。第一轮6个以及后续冲突复验的浏览器 console error 均对应预期409响应，未出现页面执行异常；不能概括为 console 完全无错。
