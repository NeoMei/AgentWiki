# F5 同步状态边界独立复审 R2

结论：APPROVE。未发现仍需修改的代码问题；真实 REST/server MCP 新构建 GREEN 尚待 root 执行，本结论不替代该验收。

审阅固定补丁 `f5-sync-state.patch` SHA256 `06103890d24ae4b5580effd10a0b63b6f0f010285f70d4f2e941b6ed340d7498`。当前两文件工作区 diff 的 SHA256 与此完全一致。只审知识同步 service/spec；未修改产品、运行构建、服务、DB 或浏览器。

## 边界与兼容

- knowledge-sync.service.ts:48-59 查询要求 Run.sourceId 为请求来源、Run.spaceId 为请求 Space、inputSourceVersion.sourceId 为相同来源；原 completed/partial 和 completedAt 降序保留。因此返回最近合法的已完成输入，不是 current head；最新损坏 Run 可被过滤而退回更早合法完成输入。
- :60-77 同时选取并回验 Run space/source、input version source、关系 ID 与标量 inputSourceVersionId。异常结果不返回版本、文件或完成时间。返回仍有授权来源的 exists=true/sourceId；sourceVersionId=null、syncedAt=null、documents=[]，不把损坏时间当同步凭据。
- 正常完整字段仍为 exists/sourceId/sourceVersionId/syncedAt/documents[{path,contentHash}]。无 Source 与有 Source 无完成输入的两种空状态保留。只选路径/hash，不增加正文输出。
- 跨 Space 输入版本与同 Space 另一个 Source 的版本均因严格 sourceId 被拒；错误 Run Space 同时受查询条件及结果回验保护。合法历史同 Source 版本没有 currentSourceVersionId 等式限制，head 更新或未完成均不会清除最后完成历史；partial 仍在 FINISHED_RUN_STATUSES 中。
- F1 metadata replay/createSync 及事务锁、receipt 分支没有改动。全文件已有 durable receipt replay/accepted epoch 测试一起通过。REST controller 与 server MCP 原样共享服务，未添加授权旁路。

## 独立验证与限制

独立运行 `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/knowledge-pipeline/knowledge-sync.service.spec.ts`：20/20 PASS、0 skip、exit 0；日志 `f5-review-independent-unit.log`。新增五类异常返回、正常非 head 历史和两类 empty-state 已核对。单测 mock 不执行 Prisma SQL，partial 的覆盖是查询合同与原常量，不声称真实 DB 下独立 partial 用例已执行。

已读取 root 旧候选 `1c5841fc` 实际 RED 结果 `document-session-r2/source-freshness-evidence-j3F2PV/sync-state-boundary-tYnCrr/result.json`：REST/server MCP 共 6 项记录，合法历史完成输入可读、跨 Source 版本暴露、错误 Run Space 完成元数据暴露均复现，且 MCP/fixture/DB 清理为 true。该证据仍是隔离独立 FK 损坏场景，不是公开写入利用证明。

待完成项仅为 root 对新构建相同 REST/server MCP 场景的 GREEN：合法旧完成输入保持原 ID/路径/hash/时间；损坏关系不得泄露版本/文件/时间；清理回执完整。无需再修改提示词、质量 fallback 或扩大 scope。
