# Whole-branch final independent product review

**Spec：符合已批准收缩后的交付范围。Quality：Approved。未关闭 Critical/Important 产品问题：0。**

固定产品范围 `165c207bf4b644efa810ea6c9a3da11d28c4f96e..ddfaf538678f95b56724d3f4b79d328e7b24adc2`。这是本地受审候选的结论，不是生产迁移、push/merge/release/deploy 或日常已安装客户端已更新的声明。根最终 docs-only 归档提交尚待给定；本回执先固定全部产品代码与实际验收，后续文档提交只需确认范围和证据表述一致。

**检索完整八题质量门禁仍 NOT MET，收益未证明。** 本批准依据原计划 fallback 仅交付有支持的参数可发现性/兼容修复，撤回五步检索 coaching 与双引策略；来源新鲜度是独立完成的能力。没有以 scope 收缩将旧失败改写为通过。

## 源码独立审查链

以下均是已有明确固定候选的独立审查，不将测试数量代替源码结论。最终整合已在 `whole-branch-preliminary-review.md` 检查跨任务调用/授权/原始快照/依赖关系；本轮复核各修复裁决、补足实际证据和最终 skill diff，没有机械重跑测试、构建、DB、服务或浏览器。

| 受审范围 | 回执 / 修复裁决 | 最终状态 |
|---|---|---|
| Retrieval harness 初版至 b42ce1ef、AOF/启动诊断至659a6ee2 | retrieval/task-1-review.md、task-1-fix1-review.md | Approved；启动与真实stdio证据独立保留 |
| 六 read tools named schema / legacy __args 至60de6602 | retrieval/task-2-review.md、whole-branch-review.md | Approved；mixed冲突拒绝，原 Space bridge 及写确认保留 |
| 持久 stdio harness至04d6fc12 | retrieval/task-3-harness-fix-review.md | Approved；私有IPC/原样参数/真实trace，旧短会话实验不覆盖 |
| Source DDL44fc5f97、backend8f22cd97→88760ac1 | source/task-1-ddl-review.md、task-1-review.md、task-1-fix-1-review.md | I1锁等待后PAT过期重验已修；M1限定fixture已修 |
| Source projection/UI c4ea4749→61ee1fd7→4423d197 | source/task-2-review.md、task-2-fix-1-review.md、task-2-fix-2-review.md | I1跨Space关联、I2关系候选、I3乐观状态、I4注入/锁观察点全部闭环；两次真实挂起原记录保留 |
| Source harness ae6537f8→e4bf0db8 | source/task-3-harness-review.md、task-3-harness-fix-1-review.md | dirty/hash manifest P2已修；build来源仍按实际metadata核验 |
| 跨任务165c207b..bf7787b6 | source/whole-branch-preliminary-review.md | 无新增后端Critical/Important；唯一Important UI-1交后续固定修复 |
| UI fix3b8c918f | source/task-3-ui-fixwave1-review.md | 中性Review文案、SOURCE_VERSION_CONFLICT指引通过源码及实际UI |
| 收缩skill ddfaf538 | source/task-3-skill-fallback-review.md | Approved；同步确认后缀2348字节逐字相同，安全/source语义保留 |

表中 retrieval/source 为 `.superpowers/sdd/2026-10-07-knowledge-retrieval/` 与 `2026-10-07-source-freshness/` 的简称。

最终重要契约未被 UI/skill 改动改变：Identity→Space advisory→Space row→sorted Sources；只有确认 intake 推进 head；A→B→A 用 generation 区分；receipt重放固定原refs且不重排队；worker固定输入不推进head；trackedOKF必须人审发布；server不接受payload自证代次；实际正文/来源关联writer失效，精确revert恢复before代次但不回退head；历史null为unknown。读取按原始Page快照、最小证据白名单、200-ID有界批量、原Principal/live sources:read与Space边界投影；拒绝脱敏，依赖故障不冒充成功。命名参数只改善发现/兼容，不接管鉴权或凭据路由。

## Source 实际验收闭环

主线证据根 `/tmp/agentwiki-knowledge-20261007/source-freshness-evidence-wS48i4`，产品bf7787b6；后续3b8c918f只改client文案/冲突提示，ddfaf538只改skill+测试，不改后端算法。

- 真实确认OKF→worker→UI人审发布 v1：正式24小时/7天。接收v2未审：旧正式正文保留、needs_review。真实部分发布仅分派48/current，保留仍7/needs_review；新Run发布剩余保留后为48/14、v2/gen2/current，v1依据historical。before/partial/after实际快照分别固定，不把整组ChangeSet状态当所有Page已复核。
- 原始HTTP及边界快照：未确认上传400/SYNC_CONFIRMATION_REQUIRED且Sources不变；durable noop键在后续headB下重放仍固定旧A/noop；v3supersede后旧批准v2发布409/SOURCE_VERSION_CONFLICT且两页完整快照不变。A同一versionId的旧generation3与新generation5区分，旧候选409；不能因versionId恢复相同自证当前。
- 实际同值/标题操作保持generation3；改正文和PageVersion restore清空generation，needs_review/page_changed。生成候选后人工改稿导致409/CHANGESET_CONFLICT，正文不变、审批数0。ChangeSet revert从gen6精确恢复gen5，两页needs_review/source_changed，Source head仍gen6；比较head字段，保留首次整份Source DTO比较过宽的操作说明。
- archive时Page unavailable、发布被拒绝且新Run被拒；activate保留head/version/gen，不自动把旧依据变成已发布。实际结果见root-archive-activate.json。受控 late-worker 暂停竞态只具service-DB证据，未包装成真实队列pause验收。
- 实际公开读授权补证：原持久reader a被撤销后REMOTE_AUTH_REQUIRED，b仍读正常；pages-only PAT授权fixture保持页面正文hash但隐藏来源身份/证据，21 raw检查通过；Source/Run/sync-state5个入口403。原始未脱敏响应由operator checker检查，而非只看harness加工后的结果。该PAT是隔离授权fixture，不是新增scope管理UI。server `/api/mcp` resources/read支持且两页通过；gateway resources/read真实-32601仍作为不支持/失败保留，不能宣称gateway resource协议通过。
- raw source报告 graphEdges=0，不能用其证明真实关系边证据权限负例；关系分支已有源码/定向单测，验收层级明确。没有新增间接语义依赖推断、自动发布、跨库搜索、CodeWiki。
- 三问独立消费者：before A明确旧正式与待审、不虚构v2；after B读取48/14并区分historical。各自原 independent-score.md保留，事实/引用通过；不与冻结八题分数相加，不证明一般检索正确率提高。

## UI实际闭环

已直接逐张看过主线13张真实截图：1280/1600/390的source notice、长ID信息抽屉、目录、18章/7124字符/12列宽表指定状态；没有新增阻断可用性问题。TOC跳转与横滚是root实际交互，docWidth辅助测量不代替图片观察。

UI-1“已发布仍需审核”源码和真实视觉均关闭：3b8c918f Review使用中性固定输入对齐文案，保留不保证事实正确限定。UI-2来源冲突中文重新生成指引在1280/390可读，409未改正文。lHQ2wQ初轮reverted截图仍显示published的问题明确保留为错误等待证据；Oy3YOx独立补图明确目标卡片“已回滚”、两item reverted、无回滚action，因此最终刷新视觉缺口关闭。GETstatus细节由root提供，reviewer直接图像所见与回执不同层次标记。

UI源码审查与构建回执保持550000初始包预算（修复构建549014）；既有Mermaid/chunk提示保留，未放宽预算。

## 冻结八题完整结果不改写

持久baseline原回执facts8/8、strict8/8；持久candidate两者strict7/8及A SourceId标签问题、旧Bprovider retry完整保留。integrated3b8c918f新评分：A facts7/8（q2漏显式spaceId）、B8/8、两者strict7/8（q4漏save）。最终scoped ddfaf538：A facts7/8（q5漏显式保存事实）、B8/8、两者grounding8/8/strict7/8；旧输出不重评分。

最终scoped真正证明的是：A16/B11 calls、0MCPerror，顶层read参数成功，实际sourceVersion标签正确且unknown未误报current；两者20预算内、独立身份/stdio、facade命令无fixture读取、私有sentinel未返回。A7search有3次空结果保留。CLI技能描述裁剪、rollout WARN、B shell snapshot ENOENT保留，不说无任何警告。requested gpt-6-astra/high与server-resolved未暴露的区别保留。最终prompt skill精确hash9f5a7721…；仅skill撤回coaching，不改题目/rubric/corpus或答案。harness691df1cb…同integrated，旧persistent为de7c104f…，不偷换“全历史同harness”。

完整新评分：`/tmp/agentwiki-knowledge-20261007/scoped-candidate/independent-score.md` 与JSON。此轮兼容PASS不等于完整质量PASS；不得声称正确率/成本/引用完整性提升。

## 清理与保留边界

source主线wS48i4、UI复验lHQ2wQ及补证Oy3YOx均有CLEANED与root外部PID/port/schema/state/ownTMPDIR/public inventory检查回执；Oy3YOx的gatewayHomeAndIpcIndependentlyAbsent=false原值保留，其session自报ipcRemoved与外部检查范围分开。早期旧DB脚本失败时不明migration bundle没有被擅删，不宣称全文件系统无任何旧临时文件。

最终scoped证据ftSQ90：cleanup.json记两gatewayExited/ipcRemoved/pendingCalls0、database/resourcesRemoved、protectedInventoryVerified；root-cleanup-verification.json确认known owned PID71434/71511/71509退出、API54419关闭、精确schema collaboration_test_349efdb24eaf432290a6d51d67a544a3及state/home/IPC/resourceRoot不存在、ownTMPDIR删除，public inventory6191ee0d…不变。此为本轮实际资源清理证据，不借其它轮次替代。

已执行受保护真实DB14/14与21/21闭环；未运行含全局ALTER DATABASE且未走保护wrapper的原始readable-sync-path-migration-db，保持DI/syntax边界并以受保护DB/真实API验证构造。增量migration corpus已审，未改旧SQL/全局设置/生产数据。原 intentional-error logger、既有build提示属已登记minor，不能称产品故障或悄悄删除。

## 最终裁决与剩余

- 批准产品ddfaf538在**参数兼容修复＋来源新鲜度/人审代际/授权投影/UI**的有限交付范围；原全部Critical/Important有代码修复与相应层次证据，未发现新阻断。
- 检索质量收益未达，按预批准fallback撤回未证实coaching；不新增上下文服务、不改rubric、不挑选重跑。
- root最终docs-only提交固定后，仍需核对最终摘要没有将有限兼容/source验收包装为检索质量通过。此待办只影响最终文档封存，不重开已固定产品代码结论。
- 不含生产部署或用户日常客户端升级。任何后续产品变化应按实际diff重新评估，而不能借本回执覆盖。

## 最终交付草稿事实核对（提交前）

已核对 `agentwiki/docs/verification/knowledge-capabilities-20261007/implementation-acceptance.md`、`source-freshness-acceptance.md`、`source-freshness-result.json`。未发现实质事实偏差；有限参数兼容/source能力通过与检索完整质量NOT MET、无收益fallback口径一致。JSON内60个证据path/SHA256逐一核验全部吻合。

另读取wS48i4/lHQ2wQ/Oy3YOx/l8LyFT/ftSQ90全部root-cleanup-verification.json：各自公共库存digest一致，检查范围与主文限定一致。Oy3YOx的false表示未记录路径因而未逐路径独立核查，不是发现残留；没有据此推断已知资源未清。

草稿仍在封存中：当次文件清单尚缺其引用的 `whole-branch-review.md` 与 `retrieval-scoped-result.json`；root已明确正在完成这两项及current/taskarchive/plan链接。此为最终docs-only固定性待核事项，不是产品问题或要求额外模型重跑。

## 最终文档全量核对通过（docs commit 前）

**文档 Spec：Compliant。Quality：Approved。新增实质问题：0。** 固定产品仍为 `ddfaf538678f95b56724d3f4b79d328e7b24adc2`；docs commit 尚待提交后固定性核验，本批准不包含产品改动。

已经完整检查当次受版本控制的文档diff及所有新增交付文件：current、architecture稳定规则、tasks/index与archive三文件、研究结果、两份plan、retrieval spec、retrieval验收历史、implementation/source验收正文及source结果JSON、integrated/scoped原评分副本、whole-branch回执副本。归档删除active由archive补齐；没有丢失原评分或实施例外说明。

此前缺少的 `whole-branch-review.md`、`retrieval-scoped-result.json` 已存在；integrated/scoped两组JSON和Markdown分别与本reviewer原回执逐字节一致，whole-branch副本也与追加本段前的原件逐字节一致。source结果仅更新最终kind与finalProductCommit，仍保留首轮bf7787b6产品身份。扫描35个本地Markdown链接目标全部存在，另显式核查新增报告的backtick文件引用；git diff --check通过。

两plan的完成checkbox已明确限定为执行结束，不冒充完整检索质量PASS；current/归档/研究/交付摘要一致保留最终A7/8、B8/8、strict各7/8及fallback。独立source生命周期批准、有限参数兼容批准、未证明检索收益、服务级竞态与实际UI证据边界、清理检查范围、无部署/升级均一致。确认同步后缀、安全/权限与原评分未因文档封存改变。

允许root将本更新回执原样复制到交付目录并创建本地docs-only提交。提交后只需核对该提交的父产品候选、实际文件范围/树内容与上述文档一致；不要求重复产品测试或模型运行。历史“草稿尚缺文件/待文档核对”的段落属于当时过程记录，已由本段关闭，不应解读为当前仍缺文档。
