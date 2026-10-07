# 第一轮任务完整性独立审计

审计对象：`/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki `；HEAD `e0f2d12ab5d4214c6e326affe305fdc3c609ca3f`，产品 `ddfaf538678f95b56724d3f4b79d328e7b24adc2`，base `165c207b`。只读检查，没有运行服务、模型、数据库，也没有修改项目文件。无 `.codegraph/`，使用 rg/读取。个人记忆registry检索无匹配，没有据此推断产品事实。

## 结论

原计划的有限产品交付没有发现未实施的主场景；未发现足以要求恢复检索coaching、追加模型追分、引入ACP/CodeWiki或部署的任务缺口。旧Approved和勾选没有充当本次依据：检查了实现、原始回执与最终差异。来源结果JSON索引的60个原始证据文件均存在，SHA-256全部吻合。`ddfaf538..HEAD`仅文档/项目交接变化；`bf7787b6..ddfaf538`产品仅Review文案/相应测试和skill说明/分发测试，旧主线后端证据未被后续后端修改失效。

发现一处值得修正文档的一致性问题，以及一项本轮全面验收值得补足的非空graph来源失权运行时证据。二者均不是已证明的后端产品缺陷。

## 逐项矩阵

路径除/tmp外相对工作树根；下面行号是本轮读取的实际文件行号。

| 原计划/契约 | 实现与独立核对 | 结论 |
|---|---|---|
| 六只读工具命名参数，legacy同值兼容、冲突拒绝、数值上下限 | `agentwiki/packages/local-sync/src/gateway/knowledge-read-tools.ts:10-54`；最终scoped真实A discovery事件确有query/pageId/skip/take/limit，成功调用正常 | 已交付，不等同检索质量收益 |
| 显式Space与独立授权，不引入全局凭据 | 同文件:4-9保留bridge既有单Space兼容；skill:18明确显式spaceId；实际撤销A后独立B仍可读，`source-freshness-acceptance.md:44`及原始权限报告 | 已交付；单Space兼容不是新默认Space机制 |
| 固定8题/2身份真实对照 | corpus与result的问题hash固定；最终scoped结果保持ddfaf538身份，A事实7/8、B8/8、严格引用均7/8；原始A事件包含工具输入输出 | 实验已执行，质量门禁NOT MET |
| 未证明收益收缩 | 最终skill:18-24只保留参数、类型、sourceStatus及不执行检索内容指令，五步coaching/双引策略撤回；retrieval plan:86-103记录fallback | 符合预批准决策；不可追分替代交付 |
| 已接收来源head/generation、版本与代次分离 | `knowledge-sync.service.ts:186-207`；`source-head.ts:20-28`；原始root-aba-generation.json同Version旧gen3、新gen5且409 | 已交付 |
| noop/existing幂等回执和重放不倒退 | `knowledge-sync.service.ts:190,231`；原始root-superseded.json与source result/hash；DB测试:63-89 | 已交付 |
| Run固定输入、worker不推head、旧候选阻止发布 | `source.service.ts:251,307,490`、`source-head.ts:59-80`；旧候选真实409，Page/Approval不变 | 已交付；队列迟到场景证据层级另述 |
| 人工逐项决定与部分发布 | 原始root-v2-before/partial/after-pages.json直接读回：24h/7d均旧→48h current与7d needs_review→48h/14d均current；不是Run完成推断 | 已交付 |
| 拒绝后重新生成 | 实际new-run固定当前head、补齐剩余页；`source-freshness-acceptance.md:27-30`，原始after页与UI截图索引hash相符 | 已交付 |
| 人工/Sync/附件/普通提案正文变动失效 | 计划Task1:57-58映射各最终writer；新增source-generation helper；服务DB:98-105、216-228含真实mixed batch；实际root-page-edit-restore.json证实人工与restore | 已实施且分层验证；未声称所有writer都经UI |
| 精确ChangeSet回滚与PageVersion恢复不同 | `review.service.ts:1794,1812,1950`恢复before代次；原始root-changeset-revert.json gen6→5且head不变；恢复清代次 | 已交付 |
| 原子冲突，不写Page/Approval | 原始root-human-conflict.json 409 CHANGESET_CONFLICT/pagesUnchanged=true/approvals=0；DB:121-126后项失败回滚 | 已交付 |
| 归档/激活 | 原始root-archive-activate.json；source acceptance:85，archive unavailable但有权历史保留，activate不增代次 | 已交付 |
| 同一Page响应快照状态 | `source-freshness.service.ts:92-94,141-163`以传入快照compare，无按Page ID重取当前正文；原始三阶段REST报告共11/11、11/11、12/12 | 已交付 |
| unknown/current/needs_review不冒充事实真值 | comparator:74-89；skill:20-22；最终scoped合成历史来源保持unknown | 已交付 |
| 来源权限失效保留独立授权正文，删除标识/Evidence/Run | projector:66-71,97-115,135-163；实际pages-only checker21/21与真实源/Run/sync-state403；source acceptance:90-94 | 已交付，PAT scope fixture非公开UI功能 |
| Review列表/detail/mutation回包脱敏 | projector:167-199统一处理；原始三阶段checker覆盖Review list/detail，结构边界测试覆盖loadChangeSet/mutation | 已实施，未将单个GET当全部接口实测 |
| graph节点及关系Evidence最小DTO | projector:124-132；`knowledge.service.spec.ts:254-280`正/负mock测试；实际最终scoped A `/tmp/agentwiki-knowledge-20261007/scoped-candidate/a/events.jsonl:24`有7节点1边、quote/location/version/sourceInfo最小字段 | 正例运行时已存在；失权非空边仍建议补验 |
| REST/MCP page resource | 原始服务器resource报告成功；stdio gateway -32601明确保留，`source-freshness-acceptance.md:46-49` | server resource交付；gateway既有不支持不属本期漏实现 |
| Page/Info/Review实际UI，1280/1600/390长文宽表 | layout回执表容器实际横滚、页面无横溢；60文件索引含截图hash；原始第三runtime `final-ui/result.json`记录published/reverted/rejected中性标签及409重新生成指引 | 已有实际证据；本子任务未重新看图，不冒称当次视觉验收 |
| 新Agent读取复核前后结论与旧依据 | 实际A/B答案与原始独立评分，source acceptance:53-72，明确模型requested而resolved未知 | 本例行为通过；非整体正确率改善 |
| 安全隔离、清理与无部署 | 三source runtime清理/外部核验保留，索引hash核对；最终文档明确旧checkout/未知临时bundle边界 | 有界清理完成，不声称全文件系统清零；无部署是范围 |

## 值得处理的项

### D1：来源spec残留已撤回双引用要求（文档一致性，低风险）

`agentwiki/docs/superpowers/specs/2026-10-07-source-freshness.md:61`仍以现行规范口吻要求“比较或驳回旧/干扰来源时，每个回答同时引用该来源和适用依据”；source plan:99也保留原实施要求，但末尾已有final disposition。最终retrieval spec:25、retrieval plan:80及最终skill:20-24明确撤回这项策略。来源spec自身没有收缩结论，单独被后续任务读取容易误当未完任务并恢复coaching。

建议只补来源spec的最终处置说明，或标记该段为原实验方案、以最终fallback为准。保留原评分与历史，不调整模型提示或恢复策略。

### E1：非空关系边在来源失权后的实际API/MCP/UI读回（补验，不是已证实产品缺陷）

来源主线 `source-freshness-acceptance.md:42`三个阶段graphEdges均0，pages-only实际检查不能证明非空关系边的evidenceId/sourceInfo/sourceMetadata全部脱敏。现有单元 `knowledge.service.spec.ts:275-279`覆盖此负例，但以mock授权和mock Prisma构造。另一方面最终scoped A事件24已有真实1边正例，故不能写“graph没有任何运行时证据”。

本次全面审查可使用隔离合成关系边和受限PAT，在实际REST和gateway读取，核对页面节点正文仍有权、关系仍可见但所有来源证据字段脱敏；如浏览器显示该边，再确认不残留旧sourceInfo/quote。无需再次调用真实模型，也无需改变固定检索语料/评分。这是比重跑已通过来源主线更有价值的补验。

## 不应扩张为待修任务的边界

- 受控迟到worker只有真实DB服务级证明：`source-freshness-db.test.mjs:25,39-40,56-59,80-89`明确没有HTTP/Redis，手动reserved并直接processRun；并不是运行队列pause/resume竞态。公开报告已诚实注明，现有guard在真实DB正确拒绝；没有证据说明当前队列会绕过它。可额外验证，但不是完整交付阻断项，不应杀有liveness guard的worker假装继续主线。
- stdio resources/read未实现是既有gateway协议边界，批准范围只要求现有server resource与六工具；无需为补验新增gateway资源服务。
- 检索严格引用7/8、A事实7/8是真实失败，已执行预批准fallback，既不能称全质量通过，也不应新开无依据的提示优化轮次。
- 本地源码skill变化不等于日常客户端已更新；ACP interface-only、CodeWiki排除、无push/merge/deploy均是范围，不是漏项。

本轮任务审计没有证明新的产品代码bug。是否宣称“无已知值得修复项”仍需合并当前代码审查、实际前后端/UI测试结果，不能由本报告替代。
