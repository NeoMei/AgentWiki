# Task 4 独立审查：#18 / #19

- 固定候选：`d8c34adf27b9de55cf001ca9b873cc32bee73afc`。
- 输入：`task-4-brief.md`、`constraints.md`、`task-4-report.md`、`task-4-review.diff`，以及原报告 #18 / #19。
- 方法：以显式 Git worktree 参数读取固定提交源码，沿 Controller → Service → SQL / 权限投影 → ReviewPage 刷新链静态审查。未更改产品代码，未运行 UI、生产或重复已有测试。未发现可用 CodeGraph 索引，不重试。

## 双结论

- **规格：暂不通过。** #18 身份展示、证据分类及人类 Owner 入口满足主要要求；#19 全量查询和稳定分页实现满足主体要求，但新增状态筛选破坏首屏外的已有深链详情，需修复后复审。
- **质量：暂不通过。** 发现 1 项 P2 功能回归；没有发现目标 Page 元数据越空间读取、分页先取后筛或旧 MCP 数组契约被改变的阻塞问题。

## Finding

### P2：状态筛选会清掉首屏外深链详情，并错误提示不在审核范围

位置：`agentwiki/apps/client/src/features/review/ReviewPage.tsx:292-297`，相关依赖在 `:246`、深链 effect 在 `:322-327`。

可确定的触发路径：

1. 打开 `/review?changeSet=<ID>`，该可读记录位于全量历史第一页之外。初始深链 effect 会获取并展开详情；初始分页响应也通过 `:224-229` 保留该记录。
2. 点击与该记录实际状态相同的状态筛选，例如“待审核”。`statusFilter` 改变后 `load` 身份变化，`:292-297` effect 清空 `items`、`expanded`、权限和 `detailedIdsRef`，重新请求筛选后的第一页。
3. 深链 effect 只依赖 `changeSetId` 和 `expandChangeSet`，两者没有变化，因此不再请求指定 ID。列表响应到达时也已无 `current` 详情可供保留。
4. 记录仍在筛选后的第二页或更后时，`visibleItems` 为空，`:528` 显示“此变更集不在你的审核范围内”。权限没有变化，用户却丢失目标记录与处理入口。即使记录恰在第一页，也会失去展开态。

建议：把深链详情重新获取与列表 scope 重置协调到同一生命周期；保证改变状态后仍能加载匹配筛选的目标 ID，同时保留现有撤权、账号切换及过期响应保护。新增定向用例应覆盖首屏外深链 → 点击其实际状态 → 详情与操作入口仍可见；再验证不匹配状态及撤权不会残留旧内容。

## 重点核对结果

- **全量检索/分页：通过。** `listPage` 将授权空间、状态、时间和关键词条件放入 `matches` CTE，再按状态优先级、`createdAt DESC`、`id DESC` 计算序号及分页；同一 SQL 语句返回 count 与 IDs。`%`、`_`、反斜杠转义并使用 Prisma 绑定参数。已有真实 DB 收据覆盖 61 条同时间记录、首屏外搜索和越界页，本次未重复运行。
- **目标元数据空间边界：通过。** 搜索 Page JOIN 同时校验 `p.spaceId = c.spaceId` 与未删除；展示查询 OR 条件同时包含 Page ID、所属 Space 和未删除，返回映射再次匹配 Space。不会用其他 Space 的 Page 标题/路径装饰当前提案。
- **Owner 权限/审核 mutation：浏览器人类权限路径通过。** 返回能力要求当前未锁定、未删除人类 Owner；Agent 返回 `human_required`，其余非 Owner 返回 `owner_required`。客户端优先服务端能力，不从旧空间缓存覆盖；普通审批写入仍经 Controller Owner 检查及事务内人类/Space/成员校验。协作专属记录继续转往协作审核入口。没有修改实际审核授权、并发基线或空间策略。
- **旧 MCP/HTTP：通过。** MCP `list_reviews` 仍直接调用原 `review.list`；无分页/筛选参数或仅 `spaceId` 的 HTTP 请求仍返回数组。现有列表方法的数据和授权投影未替换为分页 envelope。
- **列表刷新安全：部分通过。** sequence、scope、access epoch、AbortController 阻止旧页覆盖新筛选；后台刷新保留深链 ID 并继续详情刷新。上述 finding 是 scope 重置时的生命周期遗漏，现有“初始慢列表不抹掉深链”用例不足以覆盖它。

## 边界

- 本审查未把实现代理测试收据当作本轮独立执行结果；未核验原账号、原记录 UI 或生产行为。
- 页码分页的跨请求新增/状态变化可能重新排序，与报告中“不冻结跨请求快照”的限制一致。
- `reviewAccess` 目前是成员角色能力投影；个人 API 凭据的 `review:decide` scope 由发布 mutation 另外验证。本轮浏览器 JWT 场景不受影响，但不应将此字段解释为覆盖所有凭据约束的最终写入授权。
