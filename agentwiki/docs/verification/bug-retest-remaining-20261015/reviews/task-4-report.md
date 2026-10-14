# Task 4 实现报告：审核 #18 / #19

状态：实现与定向自动回归完成；未操作 UI、生产或提交/暂存。原账号原记录 UI 复验、独立审查、整支构建和发布由 root 继续。

## 根因与修复

### #18 同名记录及缺少处理入口

- 旧列表直接显示 ChangeSet.title，更新提案标题包含 UUID；未投影实际 Page 标题/路径，也不展示创建者和提交时间。
- 原 EvidencePanel 只判断能否读取来源/证据，把无 ingest 来源的直接提案也显示为“没有可访问的提取证据”。新服务端在来源权限投影前确定来源类别，来源被隐藏后仍保留 source_import 分类，不把不可访问来源推断为人工提案。拥有直接提交者且没有来源绑定的记录显示 proposal；没有可靠创建者/来源信息的旧记录保持 unknown。
- 旧详情必须再 GET 整个 Space，客户端从 members 查 owner 后才显示操作；失败或非 owner 不说明原因。新详情与分页结果返回当前 membership 的 reviewAccess；仅当前、未锁定/删除的人类 owner 获得 canDecide。客户端优先使用此结果，不再依赖整空间请求；无权时明确“仅此空间当前的所有者可以审核或发布此变更”。旧服务端响应没有 reviewAccess 时保留滚动升级兼容路径。
- 列表及展开后的记录头显示目标标题/路径、空间、直接提案或来源导入、提交者、提交时间和 ChangeSet ID；同名记录可区分。目标只在 ChangeSet 所属空间且未删除时解析；不可访问时明确提示，不从其他空间借用标题。
- 原报告某条记录当时是否具有 owner 权限无法由代码推断，本次没有降低权限来强行显示操作。服务端审批/发布事务、owner 限制、原版本与树版本校验、协作专属审核入口均保持。

### #19 长列表检索分页

- 旧 GET /review 和 MCP list 返回全量集合，UI 只有首批已加载数组上的状态过滤。
- 新 UI 使用 GET /review?page=1&pageSize=25，返回 items、total、page、pageSize、spaces；旧 HTTP 无分页/筛选参数请求及 MCP list 继续返回原数组。
- 服务端 SQL 对授权空间内全历史先应用关键词（ChangeSet 标题/ID、目标页标题/路径、候选标题及提交者名）、空间、状态、提交时间条件，再分页；总数和页面 ID 来自同一 SQL 快照。
- 固定排序为原状态优先级，其次 createdAt DESC、id DESC；默认每页 25，服务端 pageSize 上限 100。SQL 参数绑定，并转义关键词中的 LIKE 通配符；查询参数限制及日期范围校验已覆盖。
- UI 提供关键词、空间、日期、状态筛选及前后页；日期截止日按用户本地时区包含整天，服务端使用半开区间。筛选变化回到第一页；旧请求不能覆盖新筛选结果；深链指向首屏外的变更不会被列表响应抹掉。
- 新文案为 feature 内 bugReviewText helper，保持 lazy import；没有改共享 messages.ts 或 bundle 门槛。

## 改动文件（相对 agentwiki）

- apps/client/src/features/review/ReviewPage.tsx
- apps/client/src/features/review/ReviewPage.spec.tsx
- apps/client/src/i18n/bug-review-messages.ts
- apps/server/src/review/review.controller.ts
- apps/server/src/review/review.service.ts
- apps/server/src/review/review-list.query.ts
- apps/server/src/review/review-list.query.spec.ts
- apps/server/src/review/review-list.controller.spec.ts
- apps/server/src/review/review-list.spec.ts
- apps/server/src/review/review-list.db.spec.ts

## 验证收据

1. 修复前新增回归失败已确认：服务端缺少目标/权限投影和 listPage；前端不支持分页 envelope、缺少筛选和拒绝原因。
2. `pnpm --filter @agentwiki/client exec vitest run src/features/review`：2 文件，85/85 通过（ReviewPage 78、状态 badge 7）。覆盖原审批/冲突/撤权，新增全量检索参数、翻页、筛选重置、旧响应失效、首屏外深链保留和服务端权限优先。
   - 日志：`/tmp/agentwiki-remaining-20261015/task4-client-tests.log`
3. `pnpm --filter @agentwiki/server exec jest --runInBand src/review src/core/source-freshness/source-response-boundaries.spec.ts src/mcp/page-proposals.spec.ts src/mcp/agent-access-roles.spec.ts`：12 文件 225 通过，15 DB 用例按环境条件跳过。
   - 随后新增 controller 兼容/授权用例单独运行：3/3 通过。因此本组定向非 DB 用例合计 228 通过。
   - 日志：`/tmp/agentwiki-remaining-20261015/task4-server-tests.log`
4. 真实 PostgreSQL：通过本轮 `/tmp/agentwiki-remaining-20261015/runtime.json` 的专用数据库，使用 `withCollaborationTestDatabase` 创建独立 schema，未修改 public 合成 fixture。`review-list.db.spec.ts` 3/3 通过：
   - 61 条相同时间记录三页顺序及无遗漏/重复，首屏外目标标题/路径及提交者检索；特殊字符 `_` / `%` 按字面匹配。
   - 空间、状态、时间组合，空结果及越界页准确 total。
   - 跨空间目标既不可检索也不返回标题/路径；owner→viewer 后当前权限为拒绝；legacy list 仍为数组。
   - schema：`collaboration_test_bfb95c02270b4b4ea1530a81bb14acca`
   - migrationTreeDigest：`284c22842a670d2d2c7f6312bc3674d6ca87a167472c62c5061e217d164ebd79`
   - publicInventoryDigest：`53f12fa2cdd733ac4cf8464fdc908452adec229dc00c9cd6814bb0e01b456309`
   - schema 清理完成，public inventory 前后相同。
   - 收据：`/tmp/agentwiki-remaining-20261015/task4-db.log`；runner：`/tmp/agentwiki-remaining-20261015/task4-db.mjs`（运行时需 `PG_DUMP_BIN=/opt/homebrew/bin/pg_dump`）。
5. client `tsc --noEmit`、server `typecheck`、全部本组改动 TS/TSX 文件 ESLint 均通过。

## 剩余边界 / root 验收提示

- 未改 v0.12.30 直接修改页面或空间审核策略；没有发布、重新审核原记录、操作生产或更改预算。
- API4399/UI5199 root 验收时需使用新编译服务端；本代理没有清 dist 或重建正在验收的服务。
- UI 可用 `/review` 验证全局 25 条分页；输入记录后页的目标标题、路径或提交者搜索，切换空间/状态/日期；打开 owner 与 viewer 样本分别验证处理入口与原因。原报告对应 UUID 记录仍须检查实际所属空间 membership。
- 分页稳定顺序通过同时间数据验证；使用页码分页，活跃历史在页间发生新增/状态变化时会按新查询重排，不宣称跨请求冻结全历史快照。

## 独立审查 P2 修复（基线 d8c34adf）

- 复现确认：`/review?changeSet=cs-1` 能读取首屏以外详情；点击 Pending 后，列表 effect 因 load 依赖变化清空 items、expanded 和详情缓存，原深链 effect 不随 load 变化，故不再 GET 该 ID，误显示“不在审核范围”。新增 25 条/页、197 条 total 的分页 envelope 用例在修复前稳定失败于 Pending 切换后的详情消失。
- 修复：合并“作用域变化时重置/载入列表”与“载入深链详情”为同一个 effect；每次筛选改变均重新获取指定 ID。继续使用既有作用域、AbortController、响应序列及权限校验，未从列表缺席推断访问拒绝。
- 补充独立深链 loading 状态，列表已完成而详情仍在请求时不显示权限拒绝；已读取的详情与所选状态不匹配时显示无筛选结果，切回 All 后重新读取和展示详情。
- 回归用例顺序：首屏外深链初次打开 → Pending 保留详情且再次读取 → Published 隐藏待审核详情并说明无匹配 → All 重取详情并采用最新 owner_required → 再切 Pending 遇真实 403 后移除详情和操作。服务器权限逻辑未改。
- 本轮文件仅 `ReviewPage.tsx`、`ReviewPage.spec.tsx` 和本报告；未提交/暂存、未构建 dist、未操作 UI/生产。
- 验证：review 客户端 2 文件 86/86（ReviewPage 79、badge 7）；client `tsc --noEmit` 与两个修改文件 ESLint 通过。日志 `/tmp/agentwiki-remaining-20261015/task4-rereview-tests.log`。
