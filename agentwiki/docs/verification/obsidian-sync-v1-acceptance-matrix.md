# Obsidian Sync v1 验收证据矩阵

本文件记录 sync v1 基线、原 `codex/readable-sync-paths` 分支以及临时最终候选的可追溯验收证据，不替代契约。原分支仍停在 `294b694`；Fix 3A/3B/3C 及 post-completion follow-up 只存在于临时仓候选链，当前产品行为/验证基线 HEAD 为 `83a90b6`，尚未回灌原分支。状态定义：
- `run`：有真实 PostgreSQL/Redis 或浏览器/HTTP 测试直接覆盖；
- `unit`：有 Jest/Vitest/协议包测试直接覆盖；
- `code`：代码路径可审查，但暂未单独固化为验收测试；
- `gap`：尚未形成足够直接证据。

| # | 验收要求 | 证据 | 状态 |
|---|---|---|---|
| 1 | 安装码单次消费、过期、撤销、限流和并发交换 | `sync-v1-http-e2e` 覆盖创建/exchange/activate；`obsidian-integration.service.spec` 覆盖撤销和 exact replay；并发 exchange 代码有 serializable retry | run/unit |
| 2 | 明文 credential 不进入 DB/日志/普通响应 | `obsidian-integration.service.spec` 断言 list 不含 credentialHash；HTTP E2E 断言 session 不返回 secret | run/unit |
| 3 | 删除/停用用户设备凭据下一次请求失败 | `sync-v1-http-e2e` 覆盖删除 owning user 后设备请求返回 401 | run |
| 4 | 角色降级后 finalize 失败 | `sync-v1-http-e2e` 覆盖 | run |
| 5 | AgentCredential 无法调用 sync v1 人类发布端点 | `sync-v1.http.integration.spec` 覆盖 | unit |
| 6 | Snapshot/Delta 固定 revision，发布并发不混页 | `sync-v1-snapshot-fixed-revision-db` 覆盖 head 前进后旧 snapshot 仍固定原 revision | run |
| 7 | 相同批次幂等，同 index 不同 hash 拒绝 | `sync-v1-upload-idempotency-db` 覆盖 | run |
| 8 | 缺批次/总数/总字节/confirmation hash 错误拒绝 | `sync-v1-http-e2e` 覆盖非连续 batch index 拒绝；`sync-v1-confirmation-mismatch-db` 覆盖 confirmation 错误 | run |
| 9 | finalize 前 revision 变化返回 BASE_STALE | `sync-v1-base-stale-db` 覆盖 | run |
| 10 | finalize 故障注入全有或全无 | `sync-v1-finalize-rollback-db` 覆盖 writer 失败回滚 | run |
| 11 | finalize 响应丢失后 session 查询返回同一 result | `sync-v1-http-e2e` exact replay + rotated published read 覆盖 | run |
| 12 | 5000 页 / 100 MiB 有界内存 | `sync-v1-scale-db` 覆盖 | run |
| 13 | 浏览器/Node 相同 fixture 结果一致 | `packages/sync-protocol` tests 覆盖 | unit |
| 14 | Web/Review/Obsidian 都推进同一 revision | `sync-v1-unified-writer-origins-db` 覆盖 web_editor/change_set/obsidian_sync 共用 sequence；PageService/ReviewService spec 覆盖调用点 | run/unit |
| 15 | knowledgeKey/pageId 与 syncPath/path 往返不变，backfill 可重复且碰撞失败 | backfill 代码 + `sync-v1-db`/`legacy-migration-db` 覆盖迁移；backfill 重复/碰撞未单独真实 DB 测试 | code/unit |
| 16 | finalize 写 PageVersion/ChangeSet/ChangeItem/修改者/revision，归档删索引保 Relation/PageVersion | `sync-v1-finalize-side-effects-db` 覆盖更新页前置 PageVersion、published ChangeSet/ChangeItem、provenance 与 revision 同事务 | run |
| 17 | Snapshot/Delta 同时受 item/response byte 限制，单页跨分页，cursor 固定 | `sync-v1-pagination-db` 覆盖固定 pageId 顺序分页 | run |
| 18 | 契约 3.5 fixture 完全一致 | `packages/sync-protocol/fixtures.spec` 覆盖 | unit |
| 19 | Snapshot/Delta 从规范化 rows 读，不解析 legacy JSON | `SyncRevisionService` 代码；`sync-v1-compat-db` 覆盖 legacy 适配器分离 | code/unit |
| 20 | 内容 blob 去重、引用保留、GC 不删历史/staging | `revision-retention.service` 代码；`sync-v1-retention-db` 覆盖部分 | run/code |
| 21 | A→B→A 三次 revision | `sync-v1-writer-db` 覆盖 | run |
| 22 | Markdown/JSON 迁移只规范换行，U+FEFF 阻塞，非法 path fallback | `sync-v1-backfill-failure-db` 覆盖 U+FEFF 阻断且不半迁移，非法 sourcePath 确定性 fallback | run |
| 23 | 当前 local-sync 迁移前后逐字段等价，非空 base delta 为完整 bundle | `sync-v1-compat-db` 与 `sync-v1-local-sync-delta-db` 覆盖 | run |
| 24 | PageSearchDocument 与 Page/revision 同事务 | Page/Review 代码在事务内 upsert/delete；服务端 Jest 覆盖部分 | code/unit |
| 25 | Windows 保留名/非法字符/尾点空格/超长路径/Unicode 碰撞 | `packages/sync-protocol/normalize.spec` 与 HTTP path collision 覆盖 | unit/run |
| 26 | session 过期 410、保留期 GET 200+expired、之后 404 | `sync-v1-session-expiry-db` 覆盖 | run |
| 27 | 轮换凭据只能查 published result，不能写旧 session | `sync-v1-http-e2e` 覆盖 | run |
| 28 | Relation/Memory-only revision 保持 sequence/hash 和空 Delta | `sync-v1-relation-memory-delta-db` 覆盖空 Delta、hash 不变及后续 Page revision parent/sequence 连续 | run |
| 29 | create replay 在 head 前进后恢复同 session/result，绑定变化 mismatch | `sync-v1-http-e2e` 覆盖 | run |
| 30 | expand/backfill/contract 可中断重试，历史 rows 由历史 revision 重建 | `legacy-migration-db` 覆盖迁移链；backfill 幂等逻辑未单独测试 | unit/code |
| 31 | 并发 exchange/activate 同 family 收敛 | `sync-v1-http-e2e` 覆盖并发 exchange 单 provisional；新增 partial unique index 迁移强化 DB 层 active/provisional 收敛 | run/code |
| 32 | 并发相同 create session 一条；跨批 page ID 重复拒绝 | `sync-v1-concurrency-db` 覆盖 create；`sync-v1-upload-idempotency-db` 覆盖跨批重复 page ID 拒绝 | run |
| 33 | 并发 finalize 一个 result | `sync-v1-http-e2e` 覆盖 | run |
| 34 | Delta from=head 空；Relation/Memory-only 空但 to 前进 | `sync-v1-relation-memory-delta-db` 覆盖 | run |
| 35 | idFileKey 大小写不同；COM/LPT 上标；空标题/控制字符拒绝 | `packages/sync-protocol` tests 覆盖 | unit |
| 36 | 所有 routes 无 3xx | `sync-v1-http-e2e` 覆盖 installations、exchange、session、activate、credentials、push session create/upload/finalize/get/delete 的终态无 3xx | run |
| 37 | archived page upsert 恢复；跨 Space pageId 拒绝 | `sync-v1-http-e2e` 覆盖归档恢复；`sync-v1-concurrency-db` 覆盖跨 Space pageId 唯一 | run |
| 38 | exchange 后各间隙退出最多 10 分钟过期，activate 幂等，同一 family 最多一个 active | `sync-v1-human-device-state-machine-db` 覆盖旧 provisional 被新 exchange 替换、旧 activate 拒绝、新 activate 幂等且单一 active | run |
| 39 | 轮换后同 family 新凭据只能读旧 published result | `sync-v1-http-e2e` 覆盖 | run |
| 40 | 并发 PUT/DELETE/finalize/expiry cleanup 同一 session 行锁线性化 | `sync-v1-batch-concurrency-db` 覆盖并发 PUT+DELETE，且 abort 删除 staging | run |
| 41 | 两个 Space 并发同一 pageId 只成功一个 | `sync-v1-concurrency-db` 覆盖 | run |
| 42 | exchange 响应丢失后 exact replay 同 credentialId；不同绑定拒绝 | `sync-v1-http-e2e` 覆盖旧 exchange 在后续同 family exchange 后 replay 返回 409，不再误返回新 provisional | run |
| 43 | 协议包逐路由 schema 与服务端/客户端共用 | `packages/sync-protocol/schemas` + controller 引用；未自动检查所有 route | code |
| 44 | 5000/5001 changeCount 边界 | `sync-v1-http-e2e` 覆盖 5001 请求被拒 | run |
| 45 | 5000→5001 pageCount 阻断 | `sync-v1-space-too-large-db` 覆盖 5000 基线下新增 1 页被原子拒绝 | run |
| 46 | confirmationByteLength 参与幂等并限制 | `PushSessionService` 代码；HTTP E2E 覆盖正常路径 | run/code |
| 47 | capability hash 变化返回 CAPABILITIES_CHANGED | `sync-v1-http-e2e` 覆盖 | run |
| 48 | bigint decimal 精确往返 | `packages/sync-protocol` parse/schema 测试覆盖 | unit |
| 49 | installation/credential hash 碰撞路径 | `obsidian-integration.service.spec` 覆盖可控 installation hash 碰撞 fixture 后重生成 | unit |
| 50 | family 中过期 provisional 先推进再建唯一 provisional | `sync-v1-human-device-family-db` 覆盖 partial unique 约束与 expired/revoked 后再建；exchange 代码处理推进顺序 | run/code |
| 51 | head 永不清、长期 cursor 可用、cleanup deadline | `sync-v1-retention-db` 覆盖 | run |
| 52 | deployment seed 门禁/rotate | `sync-v1-deployment-seed-db` 覆盖 seed 门禁与 clone seed 拒绝 | run |
| 53 | changeCount=0 与全部 upsert 相同 noop 持久化 result | `sync-v1-http-e2e` 覆盖 changeCount=0；`sync-v1-noop-upsert-db` 覆盖全部 upsert 相同 noop | run |
| 54 | Web/ChangeSet 新建生成可读标题路径，重名使用最小 `(n)` 后缀 | `readable-sync-path.service.spec` 覆盖 Unicode、设备名、255/1024 byte、`(10)` 和软删除占用；Page/Review service spec 覆盖接入 | unit |
| 55 | 标题改名保留目录，content-only/净化等价标题路径稳定，正文/H1 不改写 | `page.service.spec` 覆盖 Web update/restore/根目录/锁内重读；`review.service.spec` 覆盖 ChangeSet 及原文保留 | unit |
| 56 | 只迁移严格 `pages/p-<64 lowercase hex>.md`，固定批次完成后直接短路，批次幂等且失败全回滚 | Fix 3 前的 `294b694` 曾在真实 PostgreSQL 扩展门禁中通过 32/32；Fix 3A 将 DB fixture 改为“旧路径 hash 与标题 hash 不同”，当前 sandbox 因无可用 DB 显式跳过该更新后的 2 项 DB 测试。生产 migration/allocator 非 DB 定向套件现为 2/2：覆盖不同-hash 二次 no-op，并覆盖批次已完成后即使新增 opaque-looking 页面也在 `lock -> batch lookup` 后短路、不扫描或写入 | run/unit |

## 结论
- 已具备真实运行证据的验收：1/2/4/5/10/11/12/13/18/20/21/23/25/27/29/33/35/39/41/48/51 等；7/8/9/17/26/31/37/42/44/47/52/53 也有先前真实 DB/HTTP 证据。
- 可读路径迁移不能再概括为“只有 code/DB skip”：Fix 3 前的 32/32 真实 PostgreSQL 门禁仍是有效历史证据；但它没有执行 Fix 3A 更新后的不同-hash fixture 或 `06dc57c` completed-batch guard。当前候选的生产 migration/allocator 非 DB 定向套件为 2/2，更新后的 DB 文件仍为 0 pass / 2 explicit skips / 0 fail。
- 临时候选 `83a90b6` 的最新可执行矩阵为 runtime 114 项（73 pass / 41 个无 `DATABASE_URL` 的显式 DB skip / 0 fail）、排除四个 loopback 文件后的 server 53 suites / 539 tests pass、client 157、protocol 22、local-sync 358。Fix 3B 的最后一次完整 server 尝试为 57 suites / 577 tests，其中 557 pass，另外四个 HTTP suites / 20 tests 仅因 sandbox `listen 127.0.0.1` 返回 `EPERM` 而失败；post-completion follow-up 后未将这 20 项冒充为已通过。
- Archive revert 现在要求明确的 `before.deletedAt: null` 且预校验 `lastModifiedAt`；缺失、非 null 或非法审计状态在事务前以稳定 `CHANGESET_INVALID_STATE` fail-closed，不会假报 revert 成功。该行为有确定性 transaction harness，不宣称真实 PostgreSQL 证明。
- 完整提交链、各阶段定向证据与环境限制见 `docs/verification/readable-sync-paths-2026-08-20.md`。上述候选未合并、未回灌原分支、未迁移生产数据库、未部署。
