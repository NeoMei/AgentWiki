# 最终候选任务覆盖审计草案（尚未关闭运行中验收）

候选：`1c5841fc`。本次只读审计，无API、浏览器、数据库、构建或产品文件修改。依据批准能力方案、归档knowledge-capabilities brief及本轮原始结果文件；没有将旧Approved、task勾选或运行队列当完成证据。

**截至本草案，代码/后端与来源补验已有依据；文档会话实际UI、更广E2E与Q2源码fixture仍pending，不应提前签署“全部通过/无已知值得修复项”。**

## 1. 候选与已修问题

`3fa75091`是本轮最后产品修改（Review失权清理）；随后`538aadd2`仅修server旧mock测试，`1c5841fc`仅刷新4个E2E旧合同。已用显式work-tree git diff核对`3fa7509..1c5841fc`只有5个测试文件，因而3fa7509/538aadd2的实际产品证据可映射到相同产品代码，但不能篡改旧回执commit为1c5841fc。

- Source历史幂等回放回滚当前metadata：独立修复审查存在；pO6o20/audit-bug-repro-*/result.json实际HTTP前后metadata/head保持B，receipt仍指原版本。
- Run/Source反向Run中的跨Space损坏关联：`run-boundary-api-GMdIQh/result.json`实际源、inputVersion、Evidence、ChangeSet异常GET均404且foreignDataVisible=false；authorized control200。该输入是明确隔离DB损坏fixture，不是公开写入可利用性的证明。列表可保留仅Evidence损坏但授权Run的安全summary，原始过严“必须完全不返回”期待已不采用；仍要求foreignValuesAbsent。
- Review来源/成员权限变化后的旧内容/写权限：focus、action、mutation原始结果分别保留；真撤销场景sensitiveVisible=false/decisionControls=0；owner降viewer场景sensitiveVisible=true但decisionControls=0，符合独立授权正文仍可读，不能误报“所有降权都隐藏正文”。R3独立代码/竞态审查已批准。
- 全量harness与旧agent-write mock、4个E2E合同修正均为测试基础设施/测试修正，未放宽产品限流或授权。E2E修正经独立审查，真实重跑仍pending。

## 2. 回归数字及精确层级

| 阶段 | 已读原始证据 | 核验值 | 限制 |
|---|---|---|---|
| runtime非数据库 | full-regression-r3.log:321-326 | 306 total，305 pass，0 fail，1 skipped | candidate3fa7509；CodeGraph独立实装gate未启用 |
| runtime数据库阶段 | 同日志:1988-1993 | 230 pass，0 fail，0 skipped | 真实隔离DB阶段；不能泛化全部230均是端到端HTTP |
| server | remaining-regression-r4.log:252-253 | 169 suites pass；2980 pass，4 skipped | R4候选538aadd2，exit0；其中connection-ux3后另补 |
| client | 同日志:267-268 | 139 files，2166 pass | Vitest单元/组件，不是浏览器总数 |
| sync-protocol | 同日志:278-279 | 10 files，140 pass | Vitest |
| local-sync | 同日志:289-290 | 68 files，985 pass，1 skipped | Windows ACL test留存skip |
| connection-ux独立DB | connection-ux-jest.log:3-11 | 1 suite，3/3 pass | 真实PostgreSQL+Redis/service模块，无API/worker/model启动；补掉server那3个gated skip |
| typecheck/build/lint | final-build-r2.json及各log | 三阶段exit0 | lint仍3 warnings、0error；build仍有大chunk warning，不能说零警告 |

**不能写“一条最终全量命令全部通过”。** full R3整体exit1，原server旧mock缺`review.toPublic`导致2979pass/1fail/4skip，runtime/DB此前已成功；独立测试修正后R4补跑server/client/protocol/local-sync全部exit0。完整证据是分阶段组合。后续1c5841fc仅E2E测试改动，不应为凑单命令绿色而反复跑已验证DB。

原日志累计skip=6（server4+local1+runtime1）；独立connection-ux补跑3后，**尚未执行的具体测试为3项**：

1. `scripts/codegraph-standard-scan-e2e.test.mjs`：`gated real CodeGraph standard scan keeps private scanner and source data local`。full R3:54明确需`AGENTWIKI_CODEGRAPH_E2E=1`与独立安装CodeGraph。不是CodeWiki功能；本期不因总数而安装/变更用户scanner。
2. `apps/server/src/assist/opencode.runner.spec.ts:535-536`：`starts the resolved bundled Windows executable without a shell`，仅win32运行。
3. `packages/local-sync/src/cli.spec.ts:325`：`does not claim Windows ACL protection that it cannot verify`，仅win32运行。

被独立补齐的3个connection-ux用例是实际模块图/并发轮询一次性交换激活、approve-deny CAS/purpose隔离、同Agent会话续期/Space/过期receipt无重复恢复。不能把单独3/3改写进原server日志使其变2983/0skip。

## 3. 本轮来源与失权补验

主source runtime：`source-freshness-evidence-pO6o20`，候选538aadd2（同当前产品代码）。

- `final-ui/result.json`：真实built UI published/reverted/rejected中性提示，1280/390过期发布409 SOURCE_VERSION_CONFLICT、重新生成指引、正文不变；有一条预期409 console error。不能写console完全无错。
- `graph-permission-f537cd04-8800-4a2b-ae3f-7aeeb2c29738/report.json`：25项检查通过。真实公开API建立临时非空edge+既有Evidence，同PAT在scope从*改pages:read前后、同server MCP客户端读取，REST/MCP来源字段被清除、nodes仍可读、正文保留、关系别名evidenceId隐藏、Source直读403。仅隔离DB调整此新PAT scopes，不是scope管理UI；MCP为真实server Streamable HTTP，不是gateway stdio。没有模型运行。
- Source元数据重放和Review权限失效的绿回执覆盖本轮真实新修问题；Run边界真实HTTP覆盖本轮另一个新修问题。旧基线失败原件仍保留。

**主source runtime已清理，证据匹配无误：** pO6o20/cleanup.json为CLEANED、databaseCleaned/protectedInventoryVerified/resourcesRemoved均true，schema=`collaboration_test_5ccf0d79d02f43ffa6b7a43f86c8f8d9`，gateway PID35953/35957退出、IPC移除。`final-source-external-cleanup.json`外部核验对应harness35705及7个登记PID均不活，53741/53742无监听，schemaCount=0，state与临时目录/双方IPC paths不存在。不要将较早nQEx5l的schema/PID配到本次外部清理。

本轮保护库存digest为`9ee00c6e08d11d0c77909847bed7e62eac583f4e7bfb9aeffc88f21aae975449`，是本轮独占DB的值；不要与旧交付6191...混写成同一DB的前后值。connection-ux四轮也已有独立external cleanup全通过。

以上只关闭已结束source/connection runtimes；**不覆盖当前文档会话、宽E2E及尚待Q2运行器的资源清理。**

## 4. 仍须接收的高价值证据

以下均已有正在推进的验收，不新增scope：

1. **文档Agent会话实际UI**：以真实编辑器/页面/会话API，受控模型fixture，证明显式Send前无请求、选择内容/引用快照正确；候选只改草稿，人工独立输入与部分接受、Undo/Redo保留；显式Save后正式正文变化及reload；页面/权限变化不恢复过期候选；桌面/390长候选、宽表、引用与输入操作可达。独立document-client-review-r2的233+60单测和只读审查不能代替本次UI。现有document-session-r2准备回执/临时state/截图不是完整通过回执。控制输出必须一直标fixture，不声称真实provider。
2. **更广built E2E**：首轮built-browser-suite-r1整体失败，存在旧版本/label/fixture导航合同问题以及auth429。4合同补丁已独立批准，待paced真实重跑结果。保持原请求限流，以分批运行而非降低安全门槛；逐spec报告passed/failed/skipped与实际目标，templates错误注入和reentry布局fixture必须分别标注。
3. **Q2源码fixture浏览器**：built dist没有`/e2e/fixtures/*.html`，404不能当产品失败。既有专用run-q2-fixture-ui.py为待运行工具，4测试必须实际执行，结果标source/dev+API/image fixture，不是built或后端验收；记录临时服务PID/端口/cache/profile清理及生产dist未改。
4. **当前运行资源收尾**：文档/宽E2E/Q2结果与失败原件归档，逐运行清理所有权回执和必要外部核验，然后root最终整合任务状态。不能复用source已清理的事实宣布后续所有runtime清理。

不建议为旧已批准收缩重新调用模型追分、增加ACP完整接入、替换搜索系统或扩建graph架构。受控迟到worker仅服务DB证据依旧诚实保留；没有新证据说明必须为本期额外改queue harness。

## 5. 最终结论应保留的边界

- 原冻结8题质量收益仍NOT MET：最终scoped A事实7/8、B8/8、严格引用均7/8。已执行预批准fallback，只保留命名参数兼容和客观sourceStatus语义；本轮未重新跑模型，不改旧分数。
- 来源旧A/B是真实native模型调用、合成输入；本轮graph/API/UI无模型，文档Agent输出是受控fixture。三者不能合并为“全部真实模型通过”。
- CodeWiki不做；CodeGraph独立实装skip是另一能力边界。ACP仅既有接口。无push/merge/release/deploy、生产迁移或日常客户端升级。
- 当前草案尚不能宣称所有前后端/UI完成或任务归档。待上述运行中项有终态、material findings关闭、资源清理明确后，root可据实际终态更新交付结论。
