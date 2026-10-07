# 最终增量代码复核 R3

**结论：需修复一项P2。新增Run边界正确保护Run接口，但相同损坏输入关系仍经knowledge-sync state读取旁路暴露。其余此次增量未建立新的值得修复问题。**

固定候选`1c5841fc`，检查`e0f2d12a..1c5841fc`全部产品fix及相邻调用；本轮无产品修改、数据库/服务/浏览器/模型或build操作。此前whole-branch R2已覆盖165c基线，本轮不重复声称整库全覆盖。

## [P2] 同一个跨Space损坏Run输入仍能通过同步状态接口返回外Space文件标识

位置：`agentwiki/apps/server/src/knowledge-pipeline/knowledge-sync.service.ts:48-75`，特别:49-53与:57-61、:72-74。

`getState(spaceId, sourceKey)`先由Space A+sourceKey找到Source A，但后续找completed/partial Run仅约束sourceId，未约束Run.spaceId；更重要的是展开`inputSourceVersion`只选择id/files，未检查该Version属于Source A。一个授权Source A下的completed Run若`inputSourceVersionId`损坏为Space B的Version，当前方法返回B的version ID及files的路径/contentHash。新`coherentRunReads`会拒绝相同Run的GET `/runs/:id`，但它没有被这一读取路径调用，因此新边界不能保护同步状态。

可达面：`knowledge-sync.controller.ts:19-28`的GET `/spaces/:spaceId/knowledge-syncs/:sourceKey`只校验个人sources:read及请求Space成员身份后调用getState，并原样投影这些文件字段；`mcp.service.ts`的`get_knowledge_sync_state`同样调用getState。仅有A权限不会因此获得B权限。文件名/路径以及版本标识本身属于来源信息，不能因未返回正文而忽略。

**复现证据：** `/tmp/agentwiki-comprehensive-audit-20261007/sync-state-boundary-r3-proof.json`。本轮纯Node调用当前已构建`KnowledgeSyncService.getState`，只替换Prisma返回值：Source A正常，completed Run展开的inputVersion为version-b/files=[B-only/private-roadmap.md]。实际结果foreignVersionReturned=true、foreignPathReturned=true；记录了两次查询参数。已与当前TS实现逐行核对；没有DB、API或源文件修改。此为损坏独立FK的防御边界复现，**不是正常公开写入接口能制造该损坏的利用证明**，与本期已接受F2损坏数据隔离验收属于同一前提。

建议最小修复：同步状态读取明确验证Run所属Space和Source、inputSourceVersion属于同一Source后才返回版本/文件；关联不一致时fail closed。可在本查询取必要身份字段后小范围校验，或复用适当的共同guard；无需重建读取服务。保留“最近完成输入”的既有同步语义，不要求改为current head，也不把旧但同Source的版本误当无权。补正常/历史同Source保留，以及foreign Run Space、foreign Version的负例；REST/MCP共同服务可一并覆盖。若做实际补验，复用已经审查的隔离损坏fixture方法即可，不需要新模型。

## 其余增量复核

- `knowledge-sync.service.ts`metadata replay修复：upsert只解析身份，Source lock之后检查确切receipt，匹配回放在metadata update之前返回；新请求才写metadata，version/head/run/receipt仍同事务。并发unique冲突winner路径重新锁身份/Space/Source，只读取确切receipt；没有找到metadata回滚再现。
- `source.service.ts`+`run-read-boundary.ts`：GET Run、列表、Source反向Run均连到guard；来源、输入/head/result版本、Evidence run/version、ChangeSet/items归属和结构化payload source/version/evidence被检查；returned Source快照与后读身份均验证，避免只检查新head却返回旧损坏head。payload before合法同Space历史版本、null输入保留；列表没加载的Evidence不能被冒称返回，所以已授权summary可保留。真实controller在helper之前仍要求live source-read及Space/Run授权，helper本身未替代授权。
- `ReviewPage.tsx`：clearInaccessible同时移除正文/permissions/comments，epoch使之前的list/detail不能恢复；后台summary覆盖source projection并使先前detail sequence失效。写入拒绝后须fresh detail和Space成员读取成功才恢复剩余阅读权限，owner降viewer不会恢复旧写按钮；正常5xx与409保留既有重试/重生路径；scope/unmount abort仍有效。未建立新的缓存复活漏洞。
- 测试harness改动：新增必需变量与stdout/stderr callback等待仍保留原退出码、完整库存与zero-skip；本轮仅静态复核，不重跑完整套件。agent-write mock及四E2E合同刷新均仅测试文件，先前独立审查结论仍适用，未隐藏运行失败或修改安全门禁。

## 新验收信息的处理

Root报告Q2源码fixture4/4及清理完成；文档真实UI两候选/人工交错/分项接受/UndoRedo/formal Save/跨页history完成，独立post-save/history读回3 turns（其中一次operator失败遗留candidate、成功receipt只2 turn IDs）；宽E2E目前5pass仍继续。上述是root的新进展，本轮代码审查未自行运行或完整核对这些新结果，不合成新的全产品PASS。文档续问/冲突/停止尚待补，本P2也必须有独立修复与相应验证后再关闭。

## F5 修复验收合同补充

完整返回投影为 `exists`、授权来源 `sourceId`、最后完成输入 `sourceVersionId`、该 Run 的 `syncedAt=completedAt`、`documents[{path,contentHash}]`。损坏 Run 的时间也不可作为已授权同步凭据返回。候选选择仍是 completed/partial 中 completedAt 最近的已完成输入，不得改为 Source 当前 head；同 Source 的合法旧版本即使不同于 head 也必须保留其 ID、完成时间与路径/hash。无 Source 与有 Source 无完成输入两种 empty-state 合同继续兼容。GET REST knowledge-sync.controller.ts:19-28 和 MCP mcp.service.ts:344-354 共享此服务边界。最终状态：1 个 P2 待修复；API RED/GREEN 脚本及实际执行由 root/新作者接手，本审阅不执行。
