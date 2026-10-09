### Spec Compliance

- ❌ Issues found：服务器切片的大部分要求已实现，但完成写入的授权／版本原子性及流式事件顺序尚未满足可依赖的行为要求；见 I1、I2。审查对象为 `9be0af67..8ddaf98a`，依据 `review-9be0af67..8ddaf98a.diff`。
- ✅ 范围契约：`agentwiki/apps/server/src/assist/assist-target.ts:19-47` 检查有限安全整数 UTF-16 偏移、非空 selection/section、完整 document（允许空文档）、精确 quote、相邻且最多 256 字符的 prefix/suffix、snapshot/base/page 时间版本。未比较草稿与已保存正文，因此允许未保存草稿。
- ✅ 旧请求及输出：`assist-target.ts:20-23,53-61` 保持无 target 请求的既有全文行为；完整 outside prefix/suffix 和最小长度检查拒绝范围外改动及首尾重叠，`assist.queue.ts:165` 在持久化前执行。`opencode.runner.ts:48-69` 保持全文 Markdown 输出并明确限定编辑范围。
- ✅ 请求者／页面绑定：`assist.service.ts:46-60,86-107`、`assist.controller.ts:60-78` 约束创建、私有读取与 page/Space；`assist.queue.ts:197-227` 将 requester/page/Space/lease 与执行检查绑定；`collaboration.gateway.ts:541-564` 使用数据库任务身份，刷新 socket 账户／token 并验证当前页面写权限后仅向请求者发送。
- ✅ 核对实际 router：`agentwiki/apps/server/src/assist/opencode.router.ts:83-96` 在每次模型尝试前调用 isActive；当前已运行 provider 不立即取消是已声明的行为边界，本次不将其列为缺陷。
- ⚠️ 客户端、整体 Task5、真实 provider、浏览器验收与发布不在此服务器切片 gate 内；未以它们尚未完成为缺陷。完整行为测试报告为 164 passed / 1 已有平台 skip、typecheck 和 diff check 通过；本审查未独立重跑该套件。

### Strengths

- `assist-target.ts:19-61` 将输入校验和输出范围保护集中成小型纯边界，拒绝显式 null／坏 target 而不静默扩大到全文。`assist.service.spec.ts:77-124` 覆盖 emoji UTF-16、错误 quote/context、过期版本与合法未保存草稿。
- `assist.queue.ts:165-175` 在 done 前做完整正文边界校验，失败不落入正常候选结果；`assist.queue.spec.ts:186-255` 覆盖范围外输出、租约失效、运行中撤权／改版与坏持久化 target。
- `assist.service.ts:86-107` 为内部读取也增加缺少 requester/Space 的 fail-closed 防线，避免 Prisma 忽略 undefined 条件；`collaboration.gateway.spec.ts:491-512` 覆盖同页面其他成员隔离与伪造 task/page/Space 绑定。

### Issues

#### Critical (Must Fix)

- 无。

#### Important (Should Fix)

- **I1 — 完成检查与 done 持久化之间仍有授权／版本竞态。** `agentwiki/apps/server/src/assist/assist.queue.ts:166-172,205-217`：完成事务先读取当前成员和 Page.updatedAt，随后仅以任务身份、租约、Space 未删除作为 updateMany 条件。`assertLiveHumanSpaceAccess` 只锁请求者 User，未锁成员／Page／Space（`core/authorization/authorization.service.ts:47-95`）。其他管理员可以在成员读取之后撤销请求者权限，或者其他编辑者可以在 page.findFirst 之后更新页面，然后该事务仍将旧结果写为 done。已确认实际撤权路径锁的是管理员自己的 User，再取得 Space 锁（`core/space/space.service.ts:483-507`）；实际页面更新也取得 Space 锁（`core/page/page.service.ts:402-412,455-456`），目前 Assist 未参与这道互斥。完成事务没有显式 isolationLevel（与创建时的 Serializable 不同），`database/prisma.service.ts:1-5` 也未设置 transactionOptions，因此继承数据库配置；在 PostgreSQL 默认 ReadCommitted 下上述交错有效，不能从现有代码推定串行化保护。Space 锁的实现是 `core/sync/space-revision-writer.service.ts:116-121` 的事务级 `pg_advisory_xact_lock(hashtext(spaceId))`，页面调用链 `content-tree/content-tree.service.ts:638-644` → `lockContentTreeSpace` → `lockSpace` 使用同一锁。现有 mock 测试只把变化安排在完成检查之前，不能覆盖这一窗口。最小兼容修复：注入既有 SpaceRevisionWriterService，遵循 User → Space 的锁顺序，在完成事务内先 lockLiveHumanPrincipal，再调用 revisionWriter.lockSpace，再重新验证当前成员、页面归属／版本并写入 done；或提供等价的数据库原子约束。增加有确定 barrier 的并发验证：暂停完成检查与写入之间，让另一用户撤权／改版，确保无法在变更已胜出的状态下保存 done。不要仅重复普通读取或假定包进事务即等于加锁。

- **I2 — 每个 chunk 的独立异步授权会打乱流顺序。** `agentwiki/apps/server/src/core/collaboration/collaboration.gateway.ts:541-562`：每条 Redis 消息分别等待任务查库、fetchSockets、账户刷新、页面授权；订阅回调在 `collaboration.gateway.ts:71-75` 使用 `void relayAssistMessage(...)` 并发启动它们。先到的 chunk A 若查库或授权较慢，后到 chunk B 或 complete 会先 emit，合法接收者得到 B/A 的文本或先完成后继续流。旧房间 prune 的共享 in-flight Promise 不能保护这些新引入的独立 await。保留流式输出时需按 taskId 串行处理事件（含 complete/error，并在处理时保留实时授权），或提供接收方可可靠排序的序列协议；当前无序 payload 不足以恢复原序。已定向核对实际消费者 `apps/client/src/features/page/AgentAssistPanel.tsx:266-268` 直接 current + data.chunk 拼接，乱序会破坏流解析；这是调用契约检查，不是对正在修改的 client 切片进行审查。最小修复是按 taskId 的 Promise 链并在队列排空时移除 Map 项，失败事件不得阻断后续清理，避免无限保留已结束 task；不必改事件协议或客户端。增加定向测试：延迟第一条事件的任务读取／授权，立即投递第二 chunk 和 complete，断言 socket 收到 A、B、complete；无需重跑大套件来证明这个问题。

#### Minor (Nice to Have)

- 无。

### Assessment

**Task quality:** Needs fixes。

**Gate decision:** 暂不通过 server slice gate；修复 I1、I2 后仅复审对应差异及定向回归。目标校验、全文边界保护与请求者私有读取设计清晰，两处异步／事务边界会影响已明确要求的实时授权、版本与 streaming 行为。

**Checks performed:** 读取一次 diff（初次工具输出截断的中段随后分块补读），未重新执行 Git、未重跑 164 项套件、未改产品文件、未派生代理。CodeGraph 先尝试返回 no index，随后使用定向文件检查。仅写入本审查文件。

**Named outside-diff checks:** (1) 撤权／版本变化是否与完成事务互斥：检查 AuthorizationService 的 live human 锁，以及 SpaceService.removeMemberAs/updateMemberRoleAs、PageService.update 的锁和写入；确认 I1。(2) 每次模型尝试是否实际使用新 isActive：检查 OpencodeModelRouter.run，确认重试门生效。(3) socket 刷新是否读取当前账户／token、事件是否有顺序串行保证：因 gateway hunk 未包含 helper／订阅完整函数，定向读取 refreshSocketPrincipal、订阅回调，以及 AuthService.validateJwtUser；确认账户锁定／删除／authVersion 检查存在，同时确认 I2 的并发入口。(4) I1 事务隔离／锁来源和 I2 顺序是否影响消费：定向核对 PrismaService 无 transactionOptions、SpaceRevisionWriterService.lockSpace / ContentTreeService.lockPageMutationSpace 的同锁路径，以及 AgentAssistPanel 的 current + chunk 拼接。除这些具名风险外未扩展代码库审查。
