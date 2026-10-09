# Agent知识读取阶段验收

2026-10-07，最终结论：**参数可用性通过，完整检索质量门禁未通过；按预批准的无收益收缩交付，撤回未证明收益的额外检索指引。** 来源更新闭环已另行完成并验收，见 `source-freshness-acceptance.md`。以下按实验顺序保留原判断，不用后续结果改写旧评分。没有推送、合并、发布或部署。

## 已交付的本地变化

产品提交60de6602为六个只读工具展示命名参数，保留legacy `__args`，拒绝冲突值，Space路由与写入确认不变。已完成独立任务/整分支审查和实际SDK/HTTP MCP验证。原基线发生过顶层pageId被旧schema丢失，后续候选真实使用命名pageId/query成功。

没有新增搜索算法或context服务。初期技能增加现有知识读取流程，最终在ddfaf538撤回未证实收益的指导；两阶段安装分发均按实际文件验证。本地源文件更新不代表用户已经安装新包。

## 固定实验与结果

前后各两个全新native Codex CLI会话，独立Agent/Credential，requested `gpt-6-astra/high`，8题、最多20次知识调用。CLI不暴露server-resolved model，不能把requested名称当后端路由证明。知识是7页授权合成语料与1个未授权诱饵；真实模型通过实际stdio gateway和隔离本地构建的服务API读取。没有fixture模型回答，没有向消费者提供rubric。

修正后的验收harness04d6fc12由每消费者一个持久stdio/SDK会话承接相同shell命令，hash为`de7c104f7a4d52a55bf54fa4f25cc60547865bd56477f8b62eed94af005bf248`。额外依赖runner的实际字节也已核对相同。旧产品固定ffd0482f、仅覆盖四个已审验收文件，产品源码hash与首次基线一致；候选固定1418d584（产品60de6602加harness/文档）。语料及题目hash前后一致，详见同目录retrieval-result.json。

| 指标 | 旧版a | 旧版b | 候选a | 候选b |
|---|---:|---:|---:|---:|
| 核心事实正确 / 实际依据可追溯 | 8/8 | 8/8 | 8/8 | 8/8 |
| 严格逐题引用覆盖 | 8/8 | 8/8 | 7/8 | 7/8 |
| 知识调用 / MCP失败 | 10 / 0 | 11 / 0 | 13 / 0 | 12 / 0 |
| 搜索调用 | 0 | 0 | 4 | 2 |
| 含发现的响应字节 | 33,196 | 33,352 | 34,396 | 31,496 |
| 模型运行墙钟秒 | 47.33 | 95.75 | 58.98 | 204.87 |

每场一次工具发现与一次持久gateway会话，启动耗时分别163/124/160/120ms，不能再与旧harness逐调用重启的gateway耗时混合。CLI实际usage及SDK耗时保存在JSON，不把缓存token加到input重复计数，不推算价格。

独立评分确认：候选q4虽然引用了足以支持结论的干扰文档，但漏了rubric要求的正式规则引用；分数保留7/8。候选a的q3把真实SourceId `kr_source_save`误称为来源版本，虽然其他实际page/evidence及v2可追溯，也必须保留该标注错误。候选b发生一次provider stream断开与CLI自动重试，204.87秒完整计入；这不是MCP错误，也不能据此声称整体更快。四次运行均有宿主skill-description预算警告，与产品调用失败分开记录。

两场新候选实际使用中文别名搜索且正常取回证据；旧版只遍历小语料，故这不是搜索排名或大型语料召回的对照。原本事实已满分，不能宣称准确率提高；两例样本也不支持总体成本降低。

## 原失败没有被覆盖

首次候选b保留4次错误。定向时序复播确认额外gateway启动/discovery流量触发120/min凭据限流，随后新进程发现不到工具。修的是验收封装，没有提高或关闭产品限流。原结果见retrieval-initial-result.json，因果边界及HTTP计数见retrieval/task-3-transient-investigation.md。新旧传输口径不同，因此双方均已重跑，没有只挑选替代候选。

## 权限与清理

所有真实模型会话只执行指定只读facade；没有读state/fixture、执行任意SQL/HTTP或调用写工具。私有sentinel没有出现在答案、事件或trace。另行operator通过同一实际网关验证中文别名搜索成功、读取未授权pageId明确拒绝；不将这两次调用算作模型行为。

每个实验使用自有随机schema、Redis、API、a/b home/credentials/socket，所有runtime已CLEANED。root独立检查API端口、harness/API/Redis/gateway PID、state、home和两处IPC目录均消失；保护性公共库存digest始终`6191ee0d4c7a10c831beec7d159577e65eba7ba68ae2fcbf6b21e2758c785ea6`。旧产品验证checkout的app归档工具报告归属/managed元数据错误，未绕过删除；仅该checkout与依赖保留，没有运行进程。

## 原阶段后续门禁（已执行，结果见下文）

来源状态DTO将明确区分SourceId、已复核与当前SourceVersion ID/版本/代次。技能仅补通用引用规则：比较或驳回旧/干扰资料时同时引适用依据，不引入题目专用提示。完成来源生命周期与UI后，以同一8题/语料/模型/预算再次检验整合候选，保留全部旧分数；历史fixture的未知来源状态不能伪造为current。

本轮无新增UI功能，不能充当来源更新UI验收。ACP仍仅原接口定义，未新增本机Agent接入。真实模型provider、合成知识输入、实际API读取、产品实现、独立审查及待验项均分别记录。

## 整合候选 3b8c918f：收益门禁仍未满足

相同冻结八题/语料/模型/预算的两位新消费者已真实复跑；skill/prompt与构建 hash 一致，新增引用指导确已分发，并非旧包造成遗漏。A 事实完整度7/8（q2漏显式spaceId）、B8/8；两者依据可追溯8/8、严格逐题引用7/8（q4都漏正式规则）；各11次call、0 MCP错误。SourceVersion ID标注正确，历史unknown未冒充current。详见 `retrieval-integrated-result.json` 和 `retrieval/integrated-independent-score.md`，旧分数不变。

响应字节含发现为37444/31198，墙钟63.328/60.985秒；未证明正确率或成本改善。当前harness hash691df1cb与旧de7c104f不同，源自已独立审查的迁移保护常量等整合变动；协议/语料/题目保持，不能称全条件相同的性能实验。两场宿主技能描述裁剪提示及11条stderr WARN保留。该runtime已CLEANED，root确认schema/端口/state/home/IPC/临时目录不存在，公共库存不变。

按已批准计划的fallback，撤回未证明收益的五步检索coaching与双引用提示，保留有实际依据的命名参数/legacy兼容修复。来源状态与ID字段含义属于独立通过的来源闭环能力，保留客观文档说明；不再以基准失败追加提示或新检索服务。收缩候选及最终验证另记，不把本轮7/8改写为通过。

## 最终收缩候选 ddfaf538：有限交付，质量收益未证明

最终产品 `ddfaf538678f95b56724d3f4b79d328e7b24adc2`，独立评分见 `retrieval-scoped-result.json` 与 `retrieval/scoped-independent-score.md`。撤回五步检索coaching及双引用提示后，再用相同冻结问题/语料/预算及两位新真实消费者核对实际工具兼容和来源语义；未改题、未提供答案、未替换旧评分。

| 指标 | A | B |
| --- | ---: | ---: |
| 事实完整度 | 7/8 | 8/8 |
| 已陈述结论可追溯 | 8/8 | 8/8 |
| 严格逐题引用 | 7/8 | 7/8 |
| calls / MCP错误 | 16 / 0 | 11 / 0 |
| search / 空结果 | 7 / 3 | 0 / 0 |
| 响应字节（含发现） | 34,863 | 37,444 |
| 模型墙钟秒 | 45.945 | 69.391 |

A q5未在该题说明采用v2需要显式保存；两份q4缺正式规则引用。别题答对或实际读过不补齐逐题评分，因此完整八题质量仍 NOT MET。两者命名参数实际成功、SourceVersion标签正确、历史unknown未冒充current，支持有限兼容与来源字段契约；不支持正确率、引用完整性、成本或速度提升。

分发skill SHA256 `9f5a77213270cfa4e8d5f8829f16409a87ff7951c63556b570fdfbe99827c625`；与prompt内提取字节一致，同步确认后缀2348字节未变。harness `691df1cb13c8ab7b10a08665f577bc51630e96615e10ffb07b421b671e03e56f` 与整合轮相同，不能说与所有历史轮相同。两者各20次预算内、独立身份与stdio，CLI exit0；requested gpt-6-astra/high，server-resolved模型未暴露。宿主技能描述裁剪、rollout WARN及B shell snapshot ENOENT保留，没有MCP失败或本轮provider stream retry。

本轮runtime `knowledge-retrieval-evidence-ftSQ90` 已CLEANED，root外部核验已知自有PID/端口/schema/state/home/IPC/resourceRoot及临时目录消失、公共库存未变。整分支独立审查批准的是**参数兼容＋来源复核闭环**这一收缩范围，未把原质量失败变成通过。来源模型三问验收独立计分，不能与本节八题相加。本期研究及实验已结束，不追加提示调优或新服务。
