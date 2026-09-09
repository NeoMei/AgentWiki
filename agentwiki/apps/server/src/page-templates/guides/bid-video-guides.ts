export const bidVideoGuides: Record<string, { zh: string; en: string }> = {
  'tender-analysis': {
    zh: `## 填写前

本页把招标资料拆成可逐项响应的要求，供团队确定写作范围。准备招标正文、附件、评分表及已收到的澄清文件，登记各自版本；不能只凭项目简介推断完整要求。缺少正文或附件时，先列缺件、索取人和预计补齐时间，受影响条目标为“待核实”。本页中的示例仅演示填法，不代表实际采购条件。

## 文件范围与时间节点

项目名称：[填写项目名称]；分析人：[填写姓名]；资料基准：[填写文件名、版本和日期]。分别记录提交截止、答疑截止和格式要求的原文位置，不将经验规则写成当前项目要求。若不同文件表述冲突，保留双方出处并列为待澄清项。

| 文件或节点 | 版本／时间及所在时区 | 原文位置 | 缺失或冲突 | 跟进人 |
| --- | --- | --- | --- | --- |
| [填写文件或节点] | [填写版本或时间] | [填写页码／条款] | [填写问题或无] | [填写负责人] |

## 评分与必答矩阵

先为每条要求分配稳定编号，再区分评分项、必答项、提交要求和背景信息。摘录必要原文，并另写团队理解，避免解释替代原文。只有原文明确给出分值、门槛或后果时才记录；没有写明则填“未说明”。

| 要求编号 | 原文及位置 | 类型／分值 | 需要回答什么 | 所需证据 | 当前疑问 |
| --- | --- | --- | --- | --- | --- |
| [填写编号] | [填写短摘录及条款] | [填写类型及原文分值] | [填写具体响应] | [填写材料类型] | [填写疑问或无] |

## 方向、边界与澄清

用一段话描述拟响应范围、关键交付物及明确不在本次范围内的事项。把“已有能力”“拟提供方案”“尚待确认”分开记录；分析者的推测不得变成能力承诺。对影响方向的问题写出可决策的选项、需要谁确认、最迟何时处理，并记录确认内容与日期；尚未收到确认时保持待定。

## 填写示例

以下为虚构练习：资料第 3.2 节写“说明数据导入失败后的处理方式”。可登记 R-01，类型为必答项，分值为“未说明”，响应为“说明失败识别、原因提示、重试与人工处理”，证据需求为“导入流程说明或演示记录”。若未收到演示记录，标注“证据待补”，不能写成“已通过全部异常场景测试”。

## 完成检查

- [ ] 已登记正文、附件和澄清文件的版本与缺件。
- [ ] 每个评分或必答项均有稳定编号和可回查的条款位置。
- [ ] 分值、时限和提交要求均来自原文，冲突没有被自行消除。
- [ ] 资料不足及影响响应方向的疑问有跟进人和状态。

## 文档衔接

把要求编号、证据需求和缺件清单交给“材料盘点”，核对哪些要求已有支持。将经确认的范围与矩阵交给“大纲与映射”，逐条安排章节。后续条款发生变化时，在本页记录新版本及受影响编号，并通知这两份文档同步调整。`,
    en: `## Before you start

Use this page to turn tender documents into individually answerable requirements. Gather the main document, attachments, scoring sheet, and received clarifications, recording their versions. A project summary alone cannot establish the complete requirements. If a document is missing, name it, assign a person to obtain it, and mark affected entries as unverified. Examples below are fictional practice material.

## Document scope and dates

Project: [Enter project name]. Analyst: [Enter name]. Source baseline: [Enter filenames, versions, and dates]. Record submission and clarification deadlines, including the stated time zone, and locate formatting instructions in their source. Record conflicting statements side by side rather than silently selecting one.

| Document or milestone | Version or date and time zone | Source location | Missing detail or conflict | Owner |
| --- | --- | --- | --- | --- |
| [Enter item] | [Enter version or time] | [Enter page or clause] | [Enter issue or none] | [Enter owner] |

## Scoring and required responses

Assign stable requirement IDs. Distinguish scored criteria, mandatory responses, submission instructions, and background. Keep short source excerpts separate from your interpretation. Record points, thresholds, or consequences only when explicitly stated; otherwise enter “not stated.”

| Requirement ID | Excerpt and location | Type and stated points | Required response | Evidence needed | Open question |
| --- | --- | --- | --- | --- | --- |
| [Enter ID] | [Enter excerpt and clause] | [Enter type and points] | [Enter response needed] | [Enter evidence type] | [Enter question or none] |

## Direction, boundaries, and clarification

Describe the proposed response scope, deliverables, and exclusions. Separate existing capability, proposed solution, and matters awaiting confirmation. An analyst's assumption must not become a delivery commitment. For each material question, record decision options, the decision owner, and the date needed. Record an actual decision and date only after confirmation.

## Worked example

Fictional exercise: clause 3.2 says “Explain how failed data imports are handled.” Create R-01 as a required response with points “not stated.” Request a description of detection, cause messages, retry, and manual handling, supported by a process description or demonstration record. If the demonstration is missing, write “evidence pending,” not “all failure scenarios tested.”

## Completion checklist

- [ ] Main documents, attachments, clarifications, versions, and missing items are recorded.
- [ ] Every scored or mandatory item has a stable ID and source location.
- [ ] Points, dates, and submission requirements match their sources; conflicts remain visible.
- [ ] Questions affecting response direction have owners and statuses.

## Related documents

Pass requirement IDs, evidence needs, and missing documents to “Material catalog.” Pass the confirmed scope and matrix to “Outline and mapping” for section assignment. When a source changes, record the new version and affected IDs here and update both downstream documents.`,
  },
  'material-catalog': {
    zh: `## 填写前

本页建立作者能实际找到、判断用途的材料索引。准备已有方案、产品说明、演示截图、案例资料及团队提供的证明文件，并对照“招标分析”的要求编号。只登记实际收到的材料；口头说“有这个案例”应登记为待索取线索。缺少文件时保留需求、负责人和到期日，不能用虚构材料补空。

## 材料登记与定位

为材料分配 M-01 等稳定编号，记录可访问的位置、版本和内容定位。文件存在不等于可用于本项目：核对适用产品版本、交付范围、时间及使用限制。涉及需处理的客户信息时，写明脱敏或授权状态，供作者选择允许使用的版本。

| 材料编号 | 名称及访问位置 | 版本／页码 | 可支持的要求 | 使用状态／限制 |
| --- | --- | --- | --- | --- |
| [填写编号] | [填写文件名和路径] | [填写版本与定位] | [填写要求编号] | [填写可用、待核实或限制] |

## 证据能力与措辞边界

逐项写清材料“能证明什么”和“不能证明什么”。产品说明可以支持功能描述，不自动证明客户实施成功；架构草图可以解释拟议方案，不自动证明已经部署。对数字、案例和资格类陈述，记录原文、有效范围及核对人；找不到对应依据的陈述保持待核实。

| 拟写陈述 | 材料编号及位置 | 支持范围 | 不支持的延伸 | 核对结论 |
| --- | --- | --- | --- | --- |
| [填写一句陈述] | [填写材料和页码] | [填写可证内容] | [填写不可推断内容] | [填写结论] |

## 缺口与替代材料

按影响排序列出缺口：影响必答响应、影响评分说明、仅影响展示质量。填写索取对象、具体所需内容、截止日期及状态。确实拿不到时提出可审阅的处理方案，例如删除无依据的业绩句、改写为拟实施流程，或保留待确认标记；是否可替代须结合原始要求确认，不能自行视为满足。

## 填写示例

虚构示例：M-03 是“导入功能说明 v0.2，第 4 页”，可支持“系统提供失败原因列表”，不支持“导入成功率达 99.9%”。R-01 需要异常处理说明，可以引用该页并补写拟议人工处理流程；性能数据仍列为缺口。此处的文件名与功能均为演示用，不代表实际产品证据。

## 完成检查

- [ ] 每份可用材料有定位、版本和对应要求编号。
- [ ] 待索取线索与已收到文件已清楚区分。
- [ ] 数据、案例与资格陈述的支持范围经过记录，未扩大推断。
- [ ] 关键缺口有负责人、处理时限及明确处置状态。

## 文档衔接

从“招标分析”接收证据需求，将材料编号、可用措辞和缺口交给“大纲与映射”。“技术章节撰写”与“服务章节撰写”应沿用本页编号引用材料。新材料补齐后更新状态，并通知引用该材料的作者重新核对相关句子。`,
    en: `## Before you start

Build an evidence index that writers can actually navigate and interpret. Gather supplied proposals, product descriptions, screenshots, case material, and supporting documents, then compare them with requirement IDs in “Tender analysis.” List only received files as available. A verbal statement that a case study exists is a lead to request, not evidence. Missing items need owners and due dates.

## Inventory and retrieval

Assign stable IDs such as M-01. Record an accessible location, version, and relevant page or section. Check product version, delivery scope, dates, and usage restrictions before marking a file usable. Record whether client details require redaction and which version writers may use.

| Material ID | Name and accessible location | Version and location within file | Requirements supported | Availability and restrictions |
| --- | --- | --- | --- | --- |
| [Enter ID] | [Enter filename and path] | [Enter version and page] | [Enter requirement IDs] | [Enter status and limits] |

## What the evidence supports

State both what each material establishes and what it does not. A product description may support a feature statement but does not establish successful customer delivery. An architecture sketch may explain a proposal but does not prove deployment. For quantitative, case-related, or qualification claims, record the source statement, scope, and checker.

| Proposed statement | Material ID and location | Supported scope | Unsupported extension | Check result |
| --- | --- | --- | --- | --- |
| [Enter one statement] | [Enter material and page] | [Enter support] | [Enter unsupported inference] | [Enter result] |

## Gaps and alternatives

Prioritize gaps affecting required responses, then scored explanations, then presentation quality. Specify exactly what is needed, from whom, by when, and its current status. If unavailable, propose a reviewable treatment: remove an unsupported achievement, describe a proposed process, or retain a pending marker. Check alternatives against the original requirement; do not assume equivalence.

## Worked example

Fictional example: M-03, “Import feature description v0.2, page 4,” supports “The system provides a failure-reason list.” It does not support “Import success reaches 99.9%.” R-01 may use the described feature alongside a clearly proposed manual-handling process, while performance evidence remains missing. The file and feature in this example are invented teaching material.

## Completion checklist

- [ ] Usable materials have locations, versions, and requirement IDs.
- [ ] Requested leads are distinct from received evidence.
- [ ] Quantitative, case, and qualification claims stay within recorded support.
- [ ] Critical gaps have owners, due dates, and disposition statuses.

## Related documents

Receive evidence needs from “Tender analysis.” Pass material IDs, permitted statements, and gaps to “Outline and mapping.” “Technical section writing” and “Service section writing” should reuse these IDs. When evidence arrives or changes, notify the writers who cited it to recheck their statements.`,
  },
  'outline-and-mapping': {
    zh: `## 填写前

本页把已确认要求变成可分工的大纲，确保作者知道每章回答什么、引用什么、由谁完成。准备“招标分析”的最新矩阵和“材料盘点”的材料索引；两者版本不一致时先标出差异。缺少要求依据或材料的章节可以规划，但必须保留缺口，不得标为已覆盖。

## 章节骨架与写作任务

先遵循来源中明确规定的目录要求，再安排有助于评审理解的层级。每章用一句话写出读者看完应得到的答案，给出预计篇幅及作者。章节不按材料文件名机械堆砌；同一主题只设一个主要说明位置，其他章节交叉说明时保持名称一致。

| 章节编号／标题 | 本章要回答的问题 | 作者 | 预计篇幅 | 输入材料／缺口 |
| --- | --- | --- | --- | --- |
| [填写编号与标题] | [填写具体问题] | [填写作者] | [填写字数或页数预算] | [填写材料编号及缺口] |

## 要求到正文的映射

逐行映射所有评分项和必答项，指定主响应章节、需要的证据及回答方式。“已映射”仅说明已安排位置，只有正文与证据完成后才可能认定覆盖。一个要求涉及多章时指定主负责作者，写清各章边界，避免彼此以为对方已回应。

| 要求编号 | 主响应章节 | 补充章节 | 证据编号 | 回答方式／待解决问题 |
| --- | --- | --- | --- | --- |
| [填写要求编号] | [填写章节] | [填写章节或无] | [填写材料编号] | [填写具体写法和缺口] |

## 图文计划与共用约定

为必要图表写出它要解释的问题、放置章节、数据来源、图中文字和正文引用位置。没有解释价值的装饰图无需安排。统一产品名称、阶段名称、交付物名称及“已有／拟议”的表述规则；技术与服务作者共享接口、里程碑和责任边界，冲突交给明确的决策人处理。

## 填写示例

虚构练习：R-01“说明导入失败处理”映射到 2.3“导入异常处理”，技术作者负责识别与重试，3.2“支持流程”只说明转人工后的受理与反馈。M-03 支持失败列表；拟画一张“失败—重试—转人工”流程图并注明为拟议流程。服务反馈时间尚未确认，保留缺口而不填默认承诺。

## 完成检查

- [ ] 所有评分项和必答项都有主响应章节及负责作者。
- [ ] 章节问题、篇幅和输入材料足以让作者直接开写。
- [ ] 图表都有解释目的、来源和正文落点，或明确无需图表。
- [ ] 跨章术语、接口和责任边界已统一，待确认项仍可见。

## 文档衔接

接收“招标分析”和“材料盘点”的版本化输入，将章节任务分别交给“技术章节撰写”和“服务章节撰写”。把同一映射表交给“覆盖与图文检查”作为核查基准；要求或目录变化时，同步更新对应章节任务，避免审校使用旧映射。`,
    en: `## Before you start

Turn confirmed requirements into an assignable outline: what each section answers, which evidence it uses, and who writes it. Prepare the latest matrix from “Tender analysis” and index from “Material catalog.” Flag version differences before planning. You may reserve a section for missing evidence, but do not mark it covered.

## Section structure and assignments

Follow any explicitly required document structure first, then organize sections to help a reviewer find answers. Give each section a reader question, owner, and length budget. Avoid reproducing a list of source filenames as the outline. Give shared topics one primary explanation location and consistent references elsewhere.

| Section ID and title | Question this section answers | Writer | Length budget | Input materials and gaps |
| --- | --- | --- | --- | --- |
| [Enter section] | [Enter concrete question] | [Enter writer] | [Enter words or pages] | [Enter material IDs and gaps] |

## Requirement-to-section mapping

Map every scored and mandatory item to a primary section, supporting evidence, and response approach. “Mapped” means assigned; it does not establish that the response and evidence are complete. If several sections address one requirement, name a lead writer and define the contribution expected from each section.

| Requirement ID | Primary response section | Supporting section | Evidence IDs | Response approach and open issue |
| --- | --- | --- | --- | --- |
| [Enter ID] | [Enter section] | [Enter section or none] | [Enter material IDs] | [Enter approach and gap] |

## Visual plan and shared conventions

For each necessary diagram, state the question it explains, placement, data source, labels, and prose reference. Omit decorative visuals with no explanatory purpose. Agree on product, phase, and deliverable names and wording for existing versus proposed capability. Share interfaces, milestones, and responsibility boundaries between technical and service writers; assign a decision owner for conflicts.

## Worked example

Fictional exercise: map R-01, “Explain import failure handling,” to 2.3, “Import exception handling.” The technical writer covers detection and retry; 3.2, “Support process,” explains receipt and feedback after manual escalation. M-03 supports the failure list. Plan a proposed “failure—retry—manual escalation” diagram. Leave support response times pending until confirmed, rather than inserting a default promise.

## Completion checklist

- [ ] Every scored and mandatory item has a primary section and writer.
- [ ] Section questions, budgets, and inputs are specific enough to begin drafting.
- [ ] Visuals have purposes, sources, and prose locations, or an explicit no-visual decision.
- [ ] Shared terminology and boundaries are aligned; unresolved decisions remain visible.

## Related documents

Receive versioned inputs from “Tender analysis” and “Material catalog.” Pass assigned sections to “Technical section writing” and “Service section writing.” Give the same mapping to “Coverage and visual check” as its review baseline. Update assignments whenever requirements or the outline change so reviewers do not check an obsolete map.`,
  },
  'write-technical-sections': {
    zh: `## 填写前

本页用于形成可合稿的技术正文，而不只是方案要点。准备“大纲与映射”、对应要求原文和已核实材料，确认自己负责的章节范围。材料只存在于索引但尚未取得时，标明待补并继续写有依据的部分。新增设计可以描述为拟议方案，不能写成已交付能力或既有测试结论。

## 分章响应与正文草稿

按批准的大纲逐章写作。每章先直接回答要求，再说明实现机制、使用流程、异常处理和验证方式。正文中保留要求编号及证据位置，方便审校回查；避免只写“先进、稳定、全面”等没有实现解释的形容词。

| 章节／要求编号 | 直接响应 | 机制与操作流程 | 材料编号及位置 | 待确认内容 |
| --- | --- | --- | --- | --- |
| [填写章节与要求] | [填写明确回答] | [填写输入、处理、输出] | [填写来源] | [填写缺口或无] |

正文草稿：[填写可直接进入合稿的连续段落，并保留小节标题]。

## 架构、接口与异常路径

描述主要组件的职责、数据流向、与外部系统的接口及依赖前提。区分已知现状与拟议设计，列出由对方提供的条件。每个关键流程至少考虑一种失败路径：如何发现、提示谁、如何恢复、何时转人工。图表要有标题、图例和正文解释；没有现成图时先写准确的绘图说明。

## 性能表述与验证边界

涉及容量、时延、可用性或安全能力时，填写目标的来源、适用条件与拟验证方法。有记录的结果须注明环境、版本和范围；没有实测就写“目标／待验证”，不以方案愿景替代结果。将部署方式、责任边界和技术前提交给服务作者核对，避免正文出现相互冲突的交付承诺。

## 填写示例

以下为虚构改写练习。原句：“平台导入永不失败，全面保障业务。”可改为：“拟在导入结束后展示处理结果；失败条目保留原因，用户修正后重试，仍失败时转人工处理。失败原因展示依据为 M-03 第 4 页；重试与转人工步骤属于拟议流程，待确认。”改写说明了动作与边界，没有虚构可靠性指标。

## 完成检查

- [ ] 分配的技术要求都有直接回答及可定位的正文。
- [ ] 关键流程写明输入、输出、异常处理和外部依赖。
- [ ] 既有能力、拟议设计、验证目标和实测结果没有混写。
- [ ] 图文解释、引用及需要服务作者确认的边界已记录。

## 文档衔接

按“大纲与映射”接收写作任务，沿用“材料盘点”的材料编号。把接口与交付前提交给“服务章节撰写”核对。将本页草稿版本、图表和未支持陈述清单交给“覆盖与图文检查”，问题处理后供“合并与润色”使用。`,
    en: `## Before you start

Produce technical prose ready for merging, rather than a list of solution ideas. Prepare “Outline and mapping,” the assigned source requirements, and verified materials. If an indexed file is unavailable, record the gap and draft the supported portions. New design ideas may be described as proposed solutions, not delivered capabilities or completed test results.

## Section responses and draft prose

Follow the agreed outline. Answer each requirement directly, then explain the mechanism, user flow, exception handling, and verification approach. Keep requirement IDs and evidence locations available for review. Replace unsupported adjectives such as “advanced” or “fully reliable” with concrete explanations.

| Section and requirement ID | Direct response | Mechanism and operating flow | Material ID and location | Pending detail |
| --- | --- | --- | --- | --- |
| [Enter section and ID] | [Enter answer] | [Enter inputs, processing, and outputs] | [Enter source] | [Enter gap or none] |

Draft prose: [Enter continuous paragraphs with section headings that can be merged into the manuscript].

## Architecture, interfaces, and failure paths

Explain component responsibilities, data movement, external interfaces, and dependencies. Separate current capability from proposed design and identify conditions the other party must provide. For each critical flow, include a failure path: detection, notification, recovery, and manual escalation. Give diagrams titles, legends, and explanatory prose; if artwork is pending, supply an accurate drawing brief.

## Performance statements and verification limits

For capacity, latency, availability, or security statements, record the target's source, operating conditions, and proposed verification. Existing results need an environment, version, and tested scope. Without measurements, label the statement as a target or pending verification. Share deployment assumptions and responsibilities with the service writer to prevent conflicting commitments.

## Worked example

Fictional rewrite: “Imports never fail and fully safeguard operations” becomes “The proposed flow displays import results and preserves reasons for failed items. Users correct items and retry; persistent failures proceed to manual handling. M-03, page 4, supports the failure-reason display. Retry and manual escalation remain proposed steps awaiting confirmation.” This explains behavior without inventing reliability metrics.

## Completion checklist

- [ ] Assigned technical requirements have direct responses in identifiable sections.
- [ ] Critical flows include inputs, outputs, failures, and external dependencies.
- [ ] Existing capability, proposed design, targets, and measured results remain distinct.
- [ ] Visual explanations, references, and cross-writer decisions are recorded.

## Related documents

Receive assignments from “Outline and mapping” and reuse IDs from “Material catalog.” Share interfaces and delivery prerequisites with “Service section writing.” Pass the draft version, visuals, and unsupported-claim list to “Coverage and visual check,” then make the corrected content available to “Merge and polish.”`,
  },
  'write-service-sections': {
    zh: `## 填写前

本页形成实施、培训、支持与交付保障的正文。准备“大纲与映射”、招标服务要求、团队确认的人员与资源资料，并核对技术方案的部署前提。服务时间、人员投入和响应承诺缺少依据时写“待确认”，指定确认人；不能把行业惯例或示例数字当作本次已同意的条件。

## 实施阶段与交付物

按可检查的成果划分阶段，每阶段写清启动条件、执行活动、双方责任、交付物及完成判据。周期需注明起算点和外部依赖，避免只列“第一周、第二周”而没有前提。若验收方式由原文规定，记录条款位置；拟定的方式应明确标为建议。

| 阶段 | 启动条件／活动 | 责任方 | 交付物 | 完成判据／依据 |
| --- | --- | --- | --- | --- |
| [填写阶段] | [填写前提及动作] | [填写双方职责] | [填写具体成果] | [填写判断方法与出处] |

## 支持受理与升级路径

写清用户从哪里报障、提供哪些信息、由谁受理、如何记录进度和关闭问题。定义问题分级时说明判断条件，区分首次响应、临时恢复和最终解决，不能混为一个时限。所有服务窗口、时限和资源投入均需有确认来源；尚待确定的内容保留责任人和决策日期。

| 场景／级别 | 受理入口 | 首次响应／恢复／解决 | 升级人及触发条件 | 承诺依据或待确认 |
| --- | --- | --- | --- | --- |
| [填写场景] | [填写入口] | [分别填写或标待确认] | [填写路径] | [填写来源与状态] |

## 培训、交接与质量控制

按受众安排培训目标、内容、形式及完成验证，例如能否独立完成指定操作。列出交接材料、维护说明和问题记录的接收人。描述变更如何提出、评估、确认并更新计划，确保新增需求不会在正文里悄悄变成免费承诺。最后写成连贯正文，并与技术章节统一阶段、组件及交付物名称。

## 填写示例

虚构练习：“上线培训”可写为“面向管理员演示账号配置和失败导入排查，交付操作说明；完成判据为参与者在演示环境独立完成练习”。培训人数、课时与安排仍填待确认。“快速响应”应拆成受理渠道与各时限字段，未确认的数值不填成保证值。

## 完成检查

- [ ] 各实施阶段都有前提、责任、交付物及完成判据。
- [ ] 首次响应、恢复和解决时限分别记录，承诺有来源或待确认状态。
- [ ] 培训与交接有具体受众、材料和验证动作。
- [ ] 技术前提、资源安排及变更边界已与技术草稿核对。

## 文档衔接

根据“大纲与映射”撰写，与“技术章节撰写”对齐交付前提；支持性资料沿用“材料盘点”的编号。向“覆盖与图文检查”提交正文、承诺清单和未确认事项；经修订的版本交给“合并与润色”，保持时限与责任表一致。`,
    en: `## Before you start

Draft implementation, training, support, and handover content. Prepare “Outline and mapping,” service requirements, confirmed staffing and resource information, and technical deployment prerequisites. If service hours, staffing, or response commitments lack support, mark them pending with a confirmation owner. Industry habits and example numbers are not agreed terms for this project.

## Delivery phases and outputs

Define phases around checkable outcomes. For each, specify entry conditions, work, responsibilities, deliverables, and completion criteria. State when a duration starts and which external dependencies affect it. Locate source-defined acceptance procedures; label newly proposed procedures as recommendations.

| Phase | Entry conditions and activities | Responsible parties | Deliverables | Completion criteria and source |
| --- | --- | --- | --- | --- |
| [Enter phase] | [Enter prerequisites and actions] | [Enter responsibilities] | [Enter concrete outputs] | [Enter check and source] |

## Support intake and escalation

Explain where users report an issue, what information they provide, who receives it, and how progress and closure are recorded. Define severity through observable conditions. Distinguish first response, temporary restoration, and final resolution. Service windows, time commitments, and resource levels require confirmation sources; pending values need owners and decision dates.

| Scenario or severity | Intake channel | First response, restoration, and resolution | Escalation owner and trigger | Commitment source or pending status |
| --- | --- | --- | --- | --- |
| [Enter scenario] | [Enter channel] | [Enter separately or mark pending] | [Enter escalation path] | [Enter source and status] |

## Training, handover, and quality control

For each audience, define training goals, content, format, and a completion exercise. Name recipients for operating instructions, maintenance notes, and issue records. Explain how change requests are raised, assessed, confirmed, and reflected in the plan so added scope does not silently become a free commitment. Turn the plan into coherent prose and align phase, component, and deliverable names with the technical draft.

## Worked example

Fictional exercise: “Launch training” becomes “Administrators practice account configuration and failed-import diagnosis, receiving operating instructions. Completion means independently performing the exercise in a demonstration environment.” Headcount, hours, and scheduling remain pending. Replace “rapid response” with separate intake and timing fields; do not populate unconfirmed guarantees.

## Completion checklist

- [ ] Delivery phases specify prerequisites, responsibilities, outputs, and completion criteria.
- [ ] Response, restoration, and resolution times are distinct and sourced or pending.
- [ ] Training and handover specify audiences, materials, and verification activities.
- [ ] Technical prerequisites, resources, and change boundaries match the technical draft.

## Related documents

Follow “Outline and mapping” and align prerequisites with “Technical section writing.” Reuse evidence IDs from “Material catalog.” Send prose, commitments, and pending decisions to “Coverage and visual check.” Supply the corrected version to “Merge and polish,” preserving the agreed responsibilities and timing table.`,
  },
  'coverage-and-visual-check': {
    zh: `## 填写前

本页对技术与服务两份草稿做逐条核查，输出作者能直接修复的问题单。准备“招标分析”“大纲与映射”“材料盘点”及两份草稿的明确版本，包含图表。缺少草稿或无法访问材料时记录“未检查”及范围，不能将未检查项算作通过。

## 要求覆盖与依据核对

从原始要求矩阵逐行出发，定位实际正文和证据，判断是否回答完整，而不是只看目录是否有同名标题。状态使用通过、部分覆盖、缺失、待核实或未检查；每个非通过项写出具体缺少的内容。统计时分别列出各状态数量，并单独列必答项，保留总数口径。

| 要求编号 | 草稿版本及段落 | 回答与证据判断 | 状态 | 问题编号 |
| --- | --- | --- | --- | --- |
| [填写要求] | [填写版本与位置] | [填写判断及依据] | [填写状态] | [填写编号或无] |

## 图表与正文互证

逐一核对图号、标题、图例、正文引用和来源。检查图中组件、流程顺序、数量与正文是否一致；拟议架构不能被图注写成已部署。图中文字、表头及单位是否可读，图表是否真正帮助回答对应要求，也应给出明确结论。没有图表时说明是否仍需流程或结构解释，不以“无图”直接判失败。

## 跨章一致性与修复单

重点比较部署方式、产品版本、人员职责、服务时限、里程碑和交付物名称。发现冲突时列出两处原文，不替作者猜测正确值。每条问题填写影响、修改要求、负责人和回查证据，修订后按新版本重新定位，不只把状态改成“已修复”。

| 问题编号 | 位置与发现 | 影响／优先级 | 修改要求 | 负责人 | 回查版本与结论 |
| --- | --- | --- | --- | --- | --- |
| [填写编号] | [填写具体段落或图号] | [填写影响] | [填写可执行修改] | [填写作者] | [填写证据或待回查] |

## 填写示例

虚构示例：R-01 的正文说明“失败后允许重试”，图 2 却把失败直接连到“结束”。登记 C-02 为图文不一致，要求作者确认真实／拟议流程后同时修改图与说明。未取得新图前保持待修复；回查时记录“草稿 v0.3，图 2 已增加重试分支”，再判断是否关闭，不能只写“作者说改好了”。

## 完成检查

- [ ] 所有要求均有检查状态，未检查范围和必答缺口单独列出。
- [ ] 每张图表的来源、标注、正文引用和内容一致性已检查。
- [ ] 跨章承诺与术语冲突有具体位置、负责人和修复要求。
- [ ] 已关闭问题都能回查到修订版本中的证据。

## 文档衔接

以“招标分析”和“大纲与映射”为基准，向“技术章节撰写”“服务章节撰写”返回具体问题。把检查范围、状态统计、回查记录及尚未解决的事项交给“合并与润色”。若缺陷源自材料本身，同步反馈“材料盘点”更新可用范围。`,
    en: `## Before you start

Review the technical and service drafts against requirements and produce an actionable issue list. Prepare identified versions of “Tender analysis,” “Outline and mapping,” “Material catalog,” and both drafts, including visuals. If a draft or source is unavailable, record the unchecked scope. Unchecked items cannot count as passed.

## Requirement coverage and support

Start from each original requirement and locate the actual response and evidence, not merely a similarly named heading. Use passed, partial, missing, unverified, or unchecked. Explain what is lacking for every non-passing item. Summarize counts by status with the total population stated, and list mandatory gaps separately.

| Requirement ID | Draft version and passage | Response and evidence assessment | Status | Issue ID |
| --- | --- | --- | --- | --- |
| [Enter requirement] | [Enter version and location] | [Enter finding and basis] | [Enter status] | [Enter ID or none] |

## Visual and prose consistency

Check figure numbers, titles, legends, prose references, and sources. Compare components, process order, quantities, and units with the text. A proposed architecture must not have a caption claiming deployment. Assess label readability and whether each visual helps answer the requirement. If there are no visuals, judge whether the explanation needs one rather than automatically failing the draft.

## Cross-section issues and repairs

Compare deployment, product versions, responsibilities, service times, milestones, and deliverable names. Quote or locate both conflicting passages instead of guessing the intended value. Record impact, requested correction, owner, and recheck evidence. After revision, inspect the new version rather than closing an issue on an author's assurance alone.

| Issue ID | Location and finding | Impact and priority | Required correction | Owner | Rechecked version and outcome |
| --- | --- | --- | --- | --- | --- |
| [Enter ID] | [Enter passage or figure] | [Enter impact] | [Enter actionable repair] | [Enter writer] | [Enter evidence or pending] |

## Worked example

Fictional example: R-01 prose permits retry after failure, but figure 2 routes failure directly to “End.” Create C-02 for inconsistency and request that the author confirm the intended flow and update both representations. Keep it open until the new figure is inspected. Record “draft v0.3, figure 2 now includes a retry branch” before deciding closure.

## Completion checklist

- [ ] All requirements have statuses; unchecked scope and mandatory gaps are explicit.
- [ ] Visual sources, labels, references, and consistency have been inspected.
- [ ] Cross-section conflicts have locations, owners, and actionable corrections.
- [ ] Closed issues have evidence in an identified revised version.

## Related documents

Use “Tender analysis” and “Outline and mapping” as the baseline. Return issues to “Technical section writing” and “Service section writing.” Pass scope, counts, recheck records, and unresolved issues to “Merge and polish.” Report evidence limitations back to “Material catalog” when the source material itself is the problem.`,
  },
  'merge-and-polish': {
    zh: `## 填写前

本页整合已经审校的技术与服务正文，形成可供人工终审的完整稿。准备两份草稿、“覆盖与图文检查”报告及“大纲与映射”的当前版本。版本不清或关键修订尚未收到时先列缺口；不能凭旧稿合并后宣称问题已解决。保留待确认事项，编辑润色不得擅自提升能力或服务承诺。

## 合稿基准与章节组装

登记每份输入的版本、作者和采用范围，按照确认的大纲组装正文。重复内容保留一个主说明位置，再补必要的前后承接；移动段落时同步调整编号和引用。最终正文应完整放在本页相应区域，而不是只列“已合并”的过程说明。

| 输入文档 | 采用版本 | 采用章节／图表 | 未采用内容及原因 |
| --- | --- | --- | --- |
| [填写草稿名称] | [填写版本] | [填写范围] | [填写重复、过期或其他原因] |

合稿正文：[填写完整 Markdown 正文，沿用已确认的章节层级]。

## 审校问题闭环

逐条处理覆盖报告，记录修订后的具体位置与核对结果。对无法关闭的事项说明缺少什么、影响哪些要求、由谁决定下一步。若修订改动了架构、承诺或证据范围，返回对应作者核对，而不是作为文字编辑直接接受。

| 问题编号 | 处理方式 | 合稿中的修订位置 | 核对依据／人员 | 状态与剩余影响 |
| --- | --- | --- | --- | --- |
| [填写编号] | [填写修改或保留原因] | [填写章节／图号] | [填写回查依据] | [填写状态] |

## 术语、叙述与终审包

统一产品名、角色、阶段、图表编号、单位及引用格式。检查每章先回答问题再展开解释，删去空泛重复句，同时保留限制条件和来源。最后重新按要求矩阵核对覆盖，整理终审者需要看的版本、主要修改、待决定事项和剩余风险。记录终审状态与实际意见；“已提交审阅”不等于“已接受”。

## 填写示例

虚构练习：技术稿写“由管理员重试失败导入”，服务稿写“所有失败由支持人员代操作”。合稿不能任选一句。登记责任冲突并请两位作者确认；若确认方案是“管理员先重试，仍失败再报障”，在技术流程与服务受理章节同时修改，再回查图中路径。确认尚未到达时保留冲突状态。

## 完成检查

- [ ] 合稿采用的版本和章节范围可追溯，完整正文已组装。
- [ ] 覆盖报告每个问题都有处置及修订位置，未关闭事项未被隐藏。
- [ ] 术语、责任、时限、图表与引用在全文保持一致。
- [ ] 终审包包含待决定事项，未将审阅提交写成正式接受。

## 文档衔接

接收“技术章节撰写”“服务章节撰写”的修订稿和“覆盖与图文检查”的报告。若内容变化影响覆盖，把修改交回“覆盖与图文检查”回查。本页作为本模板内容合稿的交付页，整理版本与未决事项供后续人工终审和导出环节使用；生成正文并不代表已经导出或对外提交。`,
    en: `## Before you start

Combine reviewed technical and service content into a complete manuscript for human final review. Prepare both drafts, “Coverage and visual check,” and the current “Outline and mapping.” Record missing revisions or unclear versions before merging. Preserve pending decisions; editorial polish must not strengthen capability claims or service commitments.

## Baseline and manuscript assembly

Record each input's version, author, and adopted scope. Assemble the manuscript in the agreed outline. Give repeated material one primary location and add necessary transitions. When moving text, update numbering and references. Include the complete merged prose below, rather than only a note saying that merging is finished.

| Input document | Adopted version | Included sections and visuals | Excluded material and reason |
| --- | --- | --- | --- |
| [Enter draft] | [Enter version] | [Enter scope] | [Enter duplicate, obsolete, or other reason] |

Merged manuscript: [Enter complete Markdown prose using the confirmed heading structure].

## Review-issue closure

Address each coverage finding with its revised location and check result. For unresolved items, identify missing information, affected requirements, and a decision owner. Return changes to architecture, commitments, or evidence scope to the relevant writer for confirmation rather than accepting them as stylistic edits.

| Issue ID | Treatment | Revised manuscript location | Verification basis and reviewer | Status and remaining impact |
| --- | --- | --- | --- | --- |
| [Enter ID] | [Enter correction or reason retained] | [Enter section or figure] | [Enter check evidence] | [Enter status] |

## Terminology, narrative, and review package

Normalize product names, roles, phases, figures, units, and citation format. Make sections answer their question before elaborating. Remove vague repetition while preserving qualifications and sources. Recheck the requirements matrix after editing. Prepare the review version, key changes, open decisions, and remaining risks. Record actual review outcomes; submitted for review does not mean accepted.

## Worked example

Fictional exercise: the technical draft assigns failed-import retries to administrators, while the service draft assigns all failures to support staff. Do not arbitrarily select a sentence. Ask the writers to resolve the responsibility conflict. If they confirm “administrators retry first, then report persistent failures,” update both sections and the diagram. Until that decision exists, retain the conflict as open.

## Completion checklist

- [ ] Adopted versions and scope are traceable, and complete prose is assembled.
- [ ] Every coverage issue has a disposition and location; unresolved items remain visible.
- [ ] Terminology, responsibilities, timings, visuals, and references are consistent.
- [ ] The review package includes open decisions and distinguishes submission from acceptance.

## Related documents

Receive corrected content from “Technical section writing” and “Service section writing” and findings from “Coverage and visual check.” Return coverage-affecting edits for rechecking. This page is the template's merged-content handoff: supply its version and open decisions for subsequent human review and export. Producing the manuscript does not establish that a file was exported or externally submitted.`,
  },
  'creative-brief': {
    zh: `## 填写前

本页让策划、研究、旁白和分镜围绕同一个观看目标工作。准备视频主题、目标时长、投放场景、已有素材和品牌语调要求。缺少品牌资料时使用清楚中性的表达，并把名称、标识与宣传措辞列为待确认；不知道受众或时长时，先写工作假设及确认人，不把假设当成已批准需求。

## 受众、问题与单一承诺

具体描述谁在什么场景观看、已经知道什么、当前卡在哪里。把视频承诺写成“看完后能理解／完成什么”，避免把多个目的堆在一句话里。明确一个主要行动，例如了解流程、尝试某个操作或继续查看资料；行动应与观看场景相容，不加入尚不存在的链接或入口。

| 字段 | 待填写内容 |
| --- | --- |
| 目标观众与观看场景 | [填写角色、设备及注意力条件] |
| 当前问题与已有认知 | [填写一个具体问题] |
| 核心承诺 | [填写看完可获得的理解或能力] |
| 主要行动与实际入口 | [填写动作及已知入口，未知则待确认] |

## 形式与制作约束

目标时长：[填写秒数]；发布位置：[填写渠道]；画幅：[填写比例]；语言：[填写语言]。记录真人、录屏、动画或混合形式，以及可用素材、预算限制和交付规格。说明是否需要旁白、字幕、背景音乐及音效；未提出的制作条件填待确认。区分本轮脚本交付与后续实际拍摄、配音、剪辑的责任。

## 品牌边界与研究问题

列出允许的语气、称谓、关键词及应避免的表达，并给出一对正反例帮助作者把握尺度。将所有需要证据的产品功能、数字、比较和效果主张转成研究问题；创意口号也要检查是否暗含无法支持的承诺。记录素材缺口与备选表达，保证后续结构不依赖拿不到的镜头。

## 填写示例

虚构练习：为一款演示用待办工具策划 45 秒竖屏短片，面向第一次整理项目任务的新用户。承诺是“看懂如何把一个模糊任务拆成可执行步骤”，主要行动是尝试拆分自己的一个任务。语气选清楚、友好；避免“效率翻倍”等未验证效果。是否展示真实界面与背景音乐使用范围列为待确认。

## 完成检查

- [ ] 受众、观看场景及一个主要问题已具体描述。
- [ ] 核心承诺与行动入口明确，没有无法支持的效果保证。
- [ ] 时长、画幅、语言及声音需求有值或明确的待确认状态。
- [ ] 品牌约束、事实研究问题和素材缺口足以指导后续工作。

## 文档衔接

将需要验证的主张交给“事实研究”，把受众、承诺、时长与形式边界交给“开场与结构”。后续定位变化应先更新本页，再同步“旁白撰写”和“分镜设计”，避免制作人员依据不同版本理解同一条视频。`,
    en: `## Before you start

Align planning, research, voiceover, and visuals around one viewing goal. Gather the topic, target duration, viewing context, available assets, and brand guidance. Without brand material, use clear, neutral language and flag names, logos, and promotional wording for confirmation. Record an owner for assumptions about the audience or duration; assumptions are not approved requirements.

## Audience, problem, and one promise

Describe who watches, in what situation, what they already know, and where they struggle. Express the promise as what viewers can understand or do afterward. Choose one primary action, such as trying an operation or consulting further information. Ensure the action fits the viewing context and uses an actual destination; do not invent a link or entry point.

| Field | Content to enter |
| --- | --- |
| Viewer and context | [Enter role, device, and attention constraints] |
| Current problem and prior knowledge | [Enter one concrete problem] |
| Core promise | [Enter intended understanding or capability] |
| Main action and actual destination | [Enter action and known destination, or pending] |

## Format and production constraints

Target duration: [Enter seconds]. Channel: [Enter location]. Aspect ratio: [Enter ratio]. Language: [Enter language]. Specify live action, screen recording, animation, or a combination, plus available assets, budget limits, and delivery requirements. Record whether narration, captions, background music, and sound effects are needed. Separate this script handoff from responsibility for later recording and editing.

## Brand boundaries and research questions

List the tone, naming conventions, preferred words, and expressions to avoid. Provide a positive and negative wording example. Turn claims about features, numbers, comparisons, or outcomes into research questions. Check whether creative slogans imply unsupported promises. Record missing assets and feasible alternatives so the structure does not depend on unavailable footage.

## Worked example

Fictional exercise: a 45-second vertical video for a demonstration task app targets people organizing their first project. Its promise is “Understand how to turn a vague task into executable steps.” The action is to split one personal task. Use friendly, clear language; avoid unverified “double your productivity” claims. Availability of real interface footage and background-music usage remains pending.

## Completion checklist

- [ ] A specific audience, viewing situation, and primary problem are defined.
- [ ] The promise and action destination contain no unsupported outcome guarantee.
- [ ] Duration, ratio, language, and audio needs are specified or explicitly pending.
- [ ] Brand limits, research questions, and asset gaps can guide the next contributors.

## Related documents

Send claims needing verification to “Fact research.” Pass the audience, promise, duration, and format constraints to “Hook and structure.” Update this brief when positioning changes, then notify “Write voiceover” and “Design storyboard” so contributors work from the same interpretation.`,
  },
  'fact-research': {
    zh: `## 填写前

本页把脚本可能使用的主张整理成可追溯事实卡。准备“创意简报”、已提供的产品资料、可访问的原始来源及演示记录。先确认需要回答的问题，再找资料；不能只因为某句话适合开场就把它当成事实。拿不到来源正文时登记为线索或待验证，并提出删去、弱化或更换表达的处理建议。

## 事实卡与来源定位

每张卡只承载一个可核实主张，分配 F-01 等编号。记录来源名称、真实访问位置、发布或版本日期、具体页码／段落／时间码及核查日期。短摘录只保留支持主张所必需的内容，另写自己的准确转述；不要编造网址、作者、数字或引用。

| 事实编号 | 拟用主张 | 来源与精确位置 | 版本／核查日期 | 支持范围与状态 |
| --- | --- | --- | --- | --- |
| [填写编号] | [填写一句可验证陈述] | [填写实际来源及定位] | [填写日期] | [填写已验证、待验证或不支持] |

## 证据强度与表达限制

逐条判断来源是否直接支持、是否过期、是否只适用于特定版本或条件。区分观察、来源的自述、估计和已测结果，记录样本与限制。数据比较要有相同口径；只有功能说明时不能推导用户收益。若来源互相冲突，保留差异与适用条件，不能为了故事顺畅任选其一。

## 脚本可用句与待核实队列

为已核实事实写一句观众能听懂的转述，并保留必要限定词。为待验证项指定处理人、所需资料和时限，给出不依赖该事实的备选句。同步检查画面计划：概念动画、示意界面与真实操作记录需明确区分，画面暗示的效果同样需要支持。

| 事实编号 | 允许用于脚本的表达 | 必须保留的限定 | 禁止延伸 | 缺口处理 |
| --- | --- | --- | --- | --- |
| [填写编号] | [填写口语化句子] | [填写适用范围] | [填写不支持的说法] | [填写补证、改写或删除] |

## 填写示例

虚构练习：演示资料展示“可将一条任务分为多个子任务”，可建立 F-01 并在练习中标为示例事实卡。可用句是“把大任务拆成几个小步骤”，不可延伸成“效率提升 50%”。真实项目中只有取得并核查实际资料后，才能把对应事实标为已验证；本示例本身不是产品证据。

## 完成检查

- [ ] 每个候选事实都有编号，来源可定位或明确标为缺失。
- [ ] 主张没有超出来源的版本、条件、样本或支持范围。
- [ ] 可用口语句保留关键限定，未核实数字没有混入正文。
- [ ] 来源冲突、素材暗示和待验证事项有明确处置。

## 文档衔接

从“创意简报”接收研究问题。将可用事实卡和表达边界交给“开场与结构”及“旁白撰写”，将视觉限制交给“分镜设计”。“时长事实品牌检查”应按本页编号回查；事实更新后列明受影响句子和镜头，通知作者修订。`,
    en: `## Before you start

Create traceable fact cards for potential script claims. Prepare “Creative brief,” supplied product documents, accessible original sources, and demonstration records. Start with the research question rather than treating an appealing opening line as fact. If a source cannot be inspected, classify it as a lead or unverified and propose removal, qualification, or replacement.

## Fact cards and source locations

Give each independently checkable claim an ID such as F-01. Record the source title, actual access location, publication or version date, exact page, passage, or timecode, and verification date. Keep excerpts limited to what supports the claim and write an accurate paraphrase separately. Never invent links, authors, quantities, or citations.

| Fact ID | Proposed claim | Source and precise location | Version and check date | Support scope and status |
| --- | --- | --- | --- | --- |
| [Enter ID] | [Enter one verifiable statement] | [Enter actual source and location] | [Enter dates] | [Enter verified, pending, or unsupported] |

## Evidence strength and wording limits

Check direct support, freshness, version applicability, and conditions. Distinguish observation, a source's self-report, estimates, and measured results; preserve sample and scope limitations. Comparisons require compatible measures. Feature descriptions alone cannot establish user outcomes. Preserve conflicting evidence and contextual differences rather than choosing whatever fits the narrative.

## Usable lines and verification queue

Write an audience-friendly sentence for each verified fact, retaining necessary qualifiers. Assign owners, requested evidence, and deadlines to pending items, with an alternative line that does not require the claim. Review visual implications too: conceptual animation, illustrative interfaces, and real operation recordings must be distinguished.

| Fact ID | Permitted script wording | Required qualification | Unsupported extension | Gap treatment |
| --- | --- | --- | --- | --- |
| [Enter ID] | [Enter spoken sentence] | [Enter scope] | [Enter unsupported wording] | [Enter verify, rewrite, or remove] |

## Worked example

Fictional exercise: demonstration material shows a task divided into subtasks. Example card F-01 could support “Break a large task into smaller steps,” but not “Increase efficiency by 50%.” In real work, inspect actual evidence before marking the corresponding fact verified. This exercise and its imaginary materials are not product evidence.

## Completion checklist

- [ ] Candidate facts have IDs and locatable sources or explicit missing-source statuses.
- [ ] Claims stay within source versions, conditions, samples, and support.
- [ ] Spoken wording preserves qualifiers and excludes unverified figures.
- [ ] Source conflicts, visual implications, and pending items have dispositions.

## Related documents

Receive questions from “Creative brief.” Pass usable cards and wording limits to “Hook and structure” and “Write voiceover,” and visual constraints to “Design storyboard.” “Duration, fact, and brand check” should verify claims through these IDs. When facts change, identify affected lines and shots for revision.`,
  },
  'hook-and-structure': {
    zh: `## 填写前

本页决定观众为何继续看、内容如何推进，以及每段分配多少时间。准备“创意简报”和“事实研究”的可用事实卡，确认目标时长与行动目标。关键事实尚未验证时，不把它放进主要承诺；可先采用具体问题或可演示动作作为开场，并记录结构依赖的待定事项。

## 开场方案与选择依据

写出两到三个短开场，每个只表达一个问题、冲突或可观察动作。说明它与目标观众的关系、后文如何兑现，不使用正文无法支持的惊人数字或效果保证。选择一个主方案，并记录为什么舍弃其他方案，避免旁白作者与分镜作者各用一套开场。

| 方案 | 开场句／画面 | 对应观众问题 | 后文兑现位置 | 选择及原因 |
| --- | --- | --- | --- | --- |
| [填写方案编号] | [填写具体开场] | [填写问题] | [填写段落编号] | [填写采用或备选及理由] |

## 节拍结构与秒数预算

使用 B-01 等段落编号，按时间先后填写起止秒数。每段写清叙事任务、核心信息、事实卡及预期画面。起止时间应连续，合计等于目标时长；留出停顿、画面阅读、转场和结尾行动的时间，不把整段时间都分给讲话。此处是预算，实际时长仍需试读核对。

| 段落 | 起止时间／秒数 | 叙事作用 | 一条核心信息 | 事实卡 | 旁白与无旁白时间 |
| --- | --- | --- | --- | --- | --- |
| [填写编号] | [填写起止与时长] | [填写问题、解释或行动] | [填写信息] | [填写编号或不涉及事实] | [填写时间预算] |

## 信息取舍与收尾动作

检查每段是否推动核心承诺，删除没有后续作用的背景介绍，必要信息过多时先压缩范围或说明需要调整时长。规划过渡句、重点重复位置与结尾行动，告诉观众具体做什么。为不可获得的素材安排替代画面；标出必须保留的事实限定，不能在结构压缩时删掉适用条件。

## 填写示例

虚构练习的 45 秒结构：0—5 秒提出“任务太大，不知先做哪一步？”；5—14 秒展示一条模糊任务；14—32 秒演示拆成三个动作；32—39 秒回顾动作顺序；39—45 秒邀请观众拆自己的一个任务。合计 45 秒。演示段预留 3 秒无旁白供看清列表，避免一边密集解说一边快速切画面。

## 完成检查

- [ ] 主开场与观众问题相符，承诺能在后文兑现。
- [ ] 段落编号唯一，时间连续，预算总和等于目标时长。
- [ ] 每段仅有清楚的核心信息，留出阅读、停顿和转场时间。
- [ ] 事实卡、备选素材与结尾具体行动已指定。

## 文档衔接

依据“创意简报”和“事实研究”安排结构，将同一版本的段落编号与时间预算分别交给“旁白撰写”和“分镜设计”。两者试写发现超时或素材不足时回到本页调整，并同步另一方；“时长事实品牌检查”用本页判断是否偏离目标。`,
    en: `## Before you start

Decide why viewers continue watching, how the argument progresses, and how much time each beat receives. Prepare “Creative brief” and usable cards from “Fact research.” Confirm the target duration and action. Keep unverified facts out of the central promise; use a concrete question or demonstrable action instead and record unresolved structural dependencies.

## Hook options and selection

Draft two or three short openings, each expressing one problem, tension, or observable action. Explain its relevance to the audience and where the video fulfills its promise. Avoid dramatic numbers or guarantees the body cannot support. Select one main hook so the voiceover and storyboard contributors do not pursue different openings.

| Option | Opening line or image | Audience problem | Payoff location | Selection and reason |
| --- | --- | --- | --- | --- |
| [Enter option ID] | [Enter concrete opening] | [Enter problem] | [Enter beat ID] | [Enter selected or backup and reason] |

## Beats and timing budget

Use IDs such as B-01 and chronological start and end times. Specify each beat's narrative job, key message, fact cards, and intended visual. Times should be continuous and total the target duration. Reserve pauses, visual reading, transitions, and the final action rather than allocating every second to speech. These are estimates until a timed reading is available.

| Beat | Start, end, and duration | Narrative function | One key message | Fact cards | Speech and non-speech allowance |
| --- | --- | --- | --- | --- | --- |
| [Enter ID] | [Enter times] | [Enter question, explanation, or action] | [Enter message] | [Enter IDs or no factual claim] | [Enter budget] |

## Information choices and ending

Check that every beat advances the promise. Remove background that does no work later. If essential content cannot fit, narrow the message or propose a duration change. Plan transitions, deliberate repetition, and a concrete final action. Provide alternatives for unavailable assets and preserve factual qualifiers when shortening the structure.

## Worked example

Fictional 45-second structure: 0–5 seconds asks “Too much to do—where do you start?”; 5–14 shows a vague task; 14–32 demonstrates three concrete steps; 32–39 reviews their order; 39–45 invites viewers to split one task of their own. The total is 45 seconds. Reserve three silent seconds in the demonstration so viewers can read the list.

## Completion checklist

- [ ] The selected hook addresses the audience and receives a credible payoff.
- [ ] Beat IDs are unique; continuous timing totals the target duration.
- [ ] Beats have clear messages and allowances for reading, pauses, and transitions.
- [ ] Fact cards, asset alternatives, and a concrete final action are assigned.

## Related documents

Build from “Creative brief” and “Fact research.” Give the same beat IDs, timing budget, and version to “Write voiceover” and “Design storyboard.” If drafting reveals timing or asset problems, revise this page and notify both contributors. “Duration, fact, and brand check” uses this structure to assess alignment with the original goal.`,
  },
  'write-voiceover': {
    zh: `## 填写前

本页写出能直接试读或录音的旁白，并让每句对应到段落和事实依据。准备“开场与结构”、事实卡和品牌语气要求，确认语言、目标声音及目标时长。缺少发音、事实或最终界面信息时分别标注待确认；制作提示必须与朗读正文分开，避免录音时把注释也读出来。

## 按段落撰写口语正文

沿用结构编号，写完整句子而非内容提纲。一句话优先讲清一个动作或判断，少用长串名词与多层转折。每行注明时间窗口、事实卡及必要声音提示；没有事实主张的过渡句可写“不涉及事实”。必要限定应进入可听见的旁白或对应可读字幕，不能只藏在编辑备注中。

| 段落／时间窗口 | 实际朗读正文 | 事实卡 | 停顿、重音与制作提示 |
| --- | --- | --- | --- |
| [填写段落及起止秒] | [填写逐字旁白] | [填写编号或不涉及事实] | [填写不朗读的提示] |

## 试读计时与压缩

记录试读人或声音版本、日期、每段实测秒数、停顿和总时长。初稿可用字数与语速粗估，但注明仅为估算；中英文不能共用同一字数换算。时长超预算时先删重复、拆长句或精简信息，再试读，不把持续加速当作唯一修正方式。读完还要留出画面阅读与结尾停留时间。

## 发音、字幕与画面对齐

列出专有名词、缩写、数字的读法，写明字幕显示形式与口头读法的区别。检查“这里、这个、下一步”等指代是否有同时间出现的明确画面。为重要操作或数字安排停顿；若画面暂未确定，写具体所需信息并交给分镜作者。记录背景音乐压低或音效进入的位置，但不假定音频素材已取得。

## 填写示例

虚构改写练习：原句“通过对任务进行结构化分解从而实现对工作流程的优化”改为“先把大任务拆开。每一步，只写一个动作。”后接“比如：列清单、分顺序、开始第一步。”重音落在“一个动作”，两句之间短停顿。此处不宣称效率提升。先作为 6—9 秒的估算窗口，再用实际声音试读调整，不将估计冒充测量。

## 完成检查

- [ ] 正文可逐字朗读，提示、来源和待确认项与正文清楚分开。
- [ ] 事实陈述有卡片编号，必要限定没有在改写中丢失。
- [ ] 每段有预算及计时状态，总时长包含停顿与阅读余量。
- [ ] 发音、字幕显示及画面指代已检查，超时段有具体修订。

## 文档衔接

从“开场与结构”取得段落预算，从“事实研究”取得可用措辞。与“分镜设计”交换逐段旁白、指代和停顿需求，随后将正文版本与计时记录交给“时长事实品牌检查”。经过审校的旁白将进入“最终脚本”。`,
    en: `## Before you start

Write narration that can be read or recorded directly, with each line tied to a beat and its evidence. Prepare “Hook and structure,” fact cards, and brand tone. Confirm language, intended voice, and target duration. Mark unknown pronunciations, facts, and interface details separately. Keep production notes outside spoken text so they are not accidentally recorded.

## Spoken prose by beat

Reuse beat IDs and write complete sentences, not an outline. Prefer one action or judgment per sentence, avoiding dense noun chains and repeated qualifications. Record the timing window, fact IDs, and useful delivery cues. Mark nonfactual transitions accordingly. Necessary qualifiers must be audible or visibly presented, not hidden only in an editor's note.

| Beat and timing window | Exact spoken text | Fact cards | Pauses, emphasis, and production cues |
| --- | --- | --- | --- |
| [Enter beat and times] | [Enter word-for-word narration] | [Enter IDs or no factual claim] | [Enter unspoken directions] |

## Timed reading and compression

Record the reader or voice version, date, measured time per beat, pauses, and total duration. Word or character counts may support a preliminary estimate, but label it as such; different languages need separate estimates. If over budget, remove repetition, split long sentences, or simplify the message before rereading. Leave time for visual reading and the closing hold rather than relying solely on faster speech.

## Pronunciation, captions, and visuals

Specify pronunciations for names, abbreviations, and numbers, distinguishing spoken forms from subtitle display. Check that “here,” “this,” and “next” point to an identifiable image at that moment. Add pauses for key operations or figures. Send specific visual needs to the storyboard writer. Note music ducking or sound-effect cues without assuming the audio assets are already available.

## Worked example

Fictional rewrite: “Through the structural decomposition of tasks, workflow optimization is achieved” becomes “Break the big task down. Give each step one action. For example: make a list, choose the order, and start step one.” Emphasize “one action” and pause between the first two sentences. No productivity result is claimed. Budget roughly 9–13 seconds as an initial estimate, then time the actual voice; do not report the estimate as a measurement.

## Completion checklist

- [ ] Narration is directly readable; cues, sources, and pending details are separate.
- [ ] Factual statements have card IDs and retain necessary qualifications.
- [ ] Beats have budgets and timing statuses, including pauses and reading allowances.
- [ ] Pronunciation, captions, visual references, and over-budget passages are addressed.

## Related documents

Receive budgets from “Hook and structure” and supported wording from “Fact research.” Exchange narration, visual references, and pause needs with “Design storyboard.” Send the draft version and timed-reading record to “Duration, fact, and brand check.” Reviewed narration proceeds to “Final script.”`,
  },
  'design-storyboard': {
    zh: `## 填写前

本页把结构转成拍摄或剪辑人员可以执行的镜头说明。准备“开场与结构”、品牌视觉要求和可用素材目录；已有旁白时一起对齐，尚未完成时先按段落编号预留对应位置。没有真实界面、录像或音乐文件时写“待提供／拟制作”，不能登记虚构路径或把示意画面称为真实演示。

## 逐镜头计划

为镜头设置 S-01 等唯一编号，沿用段落编号并填写起止时间。画面描述要说明主体、动作、景别或界面区域，以及观众需要看清的信息。单独列出屏幕文字、旁白对应句、转场和素材需求，避免只写“科技感画面”等无法执行的抽象方向。

| 镜头／段落 | 起止时间 | 主体、动作与构图 | 屏幕文字 | 旁白对应／转场 | 素材及状态 |
| --- | --- | --- | --- | --- | --- |
| [填写镜头与段落] | [填写秒数] | [填写可拍摄或制作的说明] | [填写逐字文案或无] | [填写句子与转场] | [填写实际文件或待制作] |

## 素材清单与真实性标注

区分实拍、真实录屏、概念动画、示意数据与待生成素材。每份现有素材写出真实位置、版本、可用片段和使用范围状态；未知时保留待确认。涉及数据或产品功能的画面关联事实卡。品牌标识、人物和背景音乐也需落实可用来源，不把“找到缩略图”当作取得最终素材。

## 时间、阅读与连续性

核对镜头时间连续且总时长符合结构预算。旁白与画面通常同时发生，不能重复相加；转场是否占用相邻镜头时间要写明。给屏幕文字和操作结果留阅读停顿，避免在一句话内连续切换多个信息重点。检查视线方向、操作顺序、界面状态和前后字幕一致性，按目标画幅检查重要内容是否会被裁切。

## 填写示例

虚构练习：S-03／B-03，14—20 秒，显示示意任务卡“准备分享”，依次出现“列主题、排顺序、写开头”三行，旁白为“每一步，只写一个动作”。18—20 秒保持画面供阅读，直接切入下一镜，不额外加转场时长。素材状态为“拟制作示意界面”，不能标成某个真实产品的已录制功能演示。

## 完成检查

- [ ] 每个结构段落都有镜头，镜头编号、动作和屏幕文字可执行。
- [ ] 时间连续，字幕与操作有阅读余量，转场计时规则明确。
- [ ] 真实素材、示意内容和待制作内容已区分，来源状态可回查。
- [ ] 旁白、画面、事实卡与品牌视觉一致，裁切风险已记录。

## 文档衔接

从“开场与结构”接收段落和预算，与“旁白撰写”交换镜头对应及停顿需求。使用“事实研究”核对画面暗示的主张。将分镜版本、素材清单和未决事项交给“时长事实品牌检查”，审校后由“最终脚本”合并为制作表。`,
    en: `## Before you start

Translate the structure into shots a production or editing team can execute. Gather “Hook and structure,” visual brand guidance, and the asset inventory. Align available narration; if it is still being drafted, reserve references by beat ID. Mark missing recordings, interface captures, or music as requested or planned. Do not invent file locations or present illustrative screens as real demonstrations.

## Shot-by-shot plan

Assign unique IDs such as S-01, preserve beat IDs, and enter start and end times. Specify the subject, action, framing or interface region, and what viewers must see. Separate exact screen text, narration references, transitions, and asset needs. Replace vague instructions such as “a technological feel” with producible visual directions.

| Shot and beat | Start and end | Subject, action, and composition | Screen text | Narration reference and transition | Asset and status |
| --- | --- | --- | --- | --- | --- |
| [Enter IDs] | [Enter seconds] | [Enter executable direction] | [Enter exact text or none] | [Enter line and transition] | [Enter actual file or planned asset] |

## Assets and authenticity labels

Distinguish live footage, actual screen recordings, conceptual animation, illustrative data, and planned generated assets. Existing assets need an actual location, version, usable segment, and usage status. Connect factual visual claims to fact cards. Confirm sources for brand marks, people, and music as applicable; finding a thumbnail does not establish that final production material is available.

## Timing, reading, and continuity

Check continuous timing against the structure budget. Narration and visuals generally occur together, so do not add their durations twice. Explain whether transitions overlap adjacent shots or occupy separate time. Allow viewers to read text and see operation results. Check action order, interface state, visual continuity, and caption consistency, including whether the target aspect ratio crops important content.

## Worked example

Fictional exercise: S-03/B-03 runs from 14–20 seconds. An illustrative task card, “Prepare a talk,” reveals “List topics,” “Choose the order,” and “Write the opening.” Narration says “Give each step one action.” Hold the image from 18–20 seconds for reading, then cut directly; no extra transition time is added. Label the asset “illustrative interface to create,” not a recorded feature demonstration of a real product.

## Completion checklist

- [ ] Every beat has executable shots with unique IDs, actions, and exact screen text.
- [ ] Timing is continuous, reading allowances exist, and transition accounting is explicit.
- [ ] Real, illustrative, and planned assets are distinguished with traceable statuses.
- [ ] Narration, imagery, fact cards, branding, and crop constraints are aligned.

## Related documents

Receive beats and budgets from “Hook and structure” and exchange shot references and pauses with “Write voiceover.” Use “Fact research” to check visual claims. Pass the storyboard version, assets, and open decisions to “Duration, fact, and brand check.” Reviewed shots are consolidated in “Final script.”`,
  },
  'duration-fact-brand-check': {
    zh: `## 填写前

本页检查脚本是否在给定时长内讲清内容，并让事实、品牌和画面保持一致。准备“旁白撰写”“分镜设计”“事实研究”及“创意简报”的明确版本，附已有试读记录。缺少试读或最终素材时标注检查限制，可以给预算判断，不能声称已经通过实测或成片检查。

## 时长与视听对齐

逐段比较旁白实测时间、分镜窗口及阅读停顿，检查片头、转场、结尾停留是否已计入。旁白和画面重叠播放时按同一时间轴检查，不把两者相加。记录估算与实测的区别；发现超时或过密时指定删句、拆镜、延长停留或调整结构的具体修订。

| 段落／镜头 | 计划窗口 | 旁白计时及测量方式 | 阅读与转场余量 | 结论／修改 |
| --- | --- | --- | --- | --- |
| [填写编号] | [填写起止时间] | [填写实测或估算及来源] | [填写秒数及不足] | [填写通过或修订] |

## 事实、字幕与素材核查

对旁白、屏幕文字、图表和画面暗示逐项核对事实卡，特别检查数字、比较、效果和适用条件。确认字幕没有删掉必要限定，示意画面标注没有在合成计划中消失。检查素材来源和可用状态；未取得文件或无法确认支持关系的内容保持待处理，而不是因镜头好看而通过。

## 品牌语气与问题分级

对照简报检查称谓、语气、标识使用、行动入口及禁止措辞。问题单写清位置、具体句子或画面、原因、修改要求、负责人和回查结果。区分阻碍交付的问题与可选润色建议，避免一句“整体不错”掩盖关键缺口。修改事实或时间轴后要回查受影响的另一份文档。

| 问题编号 | 位置与原内容 | 类别／影响 | 可执行修订 | 负责人 | 新版本回查结果 |
| --- | --- | --- | --- | --- | --- |
| [填写编号] | [填写句子或镜头] | [填写时长、事实或品牌影响] | [填写改法] | [填写作者] | [填写结果或待回查] |

## 填写示例

虚构检查记录：B-03 预算 8 秒，示例试读记录为 11 秒，画面还有三行需阅读。登记 T-01，要求删去重复解释并保留 2 秒阅读；重新试读后再判断。另发现字幕“保证不遗漏”无事实支持，登记 F-02，改为描述操作“把步骤列出来”，并同时检查旁白是否残留原句。示例计时不是本项目测量结果。

## 完成检查

- [ ] 总时间轴含停顿、转场与结尾，估算和实测已明确区分。
- [ ] 旁白、字幕及视觉主张均有事实依据或未解决状态。
- [ ] 品牌、行动入口、素材可用性和示意标注已检查。
- [ ] 问题有具体修订与回查证据，交付阻碍单独列明。

## 文档衔接

将问题分别返给“旁白撰写”和“分镜设计”；来源问题同步“事实研究”，结构超时反馈“开场与结构”。向“最终脚本”交付检查版本、已关闭问题、剩余限制和待确认事项，供合稿时保持同一套时间与事实口径。`,
    en: `## Before you start

Check whether the script communicates within its duration while keeping facts, brand language, and visuals aligned. Prepare identified versions of “Write voiceover,” “Design storyboard,” “Fact research,” and “Creative brief,” plus available timed readings. Without readings or final assets, state the review limits. A budget assessment is not a measured timing pass or a finished-video inspection.

## Duration and audiovisual alignment

Compare narration measurements, shot windows, and reading pauses for each beat. Include opening, transitions, and closing holds. Evaluate simultaneous audio and imagery on one timeline rather than adding them together. Distinguish estimates from measurements. For overcrowded or long beats, prescribe cuts, split shots, longer holds, or structural changes.

| Beat or shot | Planned window | Narration timing and measurement basis | Reading and transition allowance | Finding and correction |
| --- | --- | --- | --- | --- |
| [Enter IDs] | [Enter times] | [Enter measured or estimated duration and source] | [Enter seconds and shortfall] | [Enter pass or repair] |

## Facts, captions, and assets

Check narration, screen text, charts, and implied visual claims against fact cards, especially numbers, comparisons, outcomes, and conditions. Ensure captions retain necessary qualifiers and illustrative labels remain in the production plan. Inspect asset provenance and availability. Missing files or uncertain support remain open regardless of the visual's appeal.

## Brand tone and issue severity

Check names, tone, marks, action destinations, and prohibited wording against the brief. For each finding, locate the exact line or shot, explain the issue, request a concrete correction, and record its owner and recheck result. Separate delivery blockers from optional polish. Changes to facts or timing require rechecking the corresponding narration or storyboard.

| Issue ID | Location and original content | Category and impact | Actionable correction | Owner | Revised-version recheck |
| --- | --- | --- | --- | --- | --- |
| [Enter ID] | [Enter line or shot] | [Enter timing, fact, or brand impact] | [Enter repair] | [Enter author] | [Enter outcome or pending] |

## Worked example

Fictional review: B-03 has an eight-second budget, but an example reading takes eleven seconds and viewers must read three lines. Create T-01 to remove repeated explanation and preserve two reading seconds, then require a new timed reading. Separately, replace unsupported caption “Guaranteed never to miss anything” with “List the steps” and inspect narration for the same claim. These example times are not project measurements.

## Completion checklist

- [ ] The timeline includes pauses, transitions, and closing time; estimates and measurements are distinct.
- [ ] Spoken, captioned, and visual claims have support or explicit open statuses.
- [ ] Branding, destinations, asset availability, and illustrative labels are checked.
- [ ] Findings have concrete repairs and recheck evidence; delivery blockers are listed separately.

## Related documents

Return findings to “Write voiceover” and “Design storyboard.” Send source issues to “Fact research” and structural timing issues to “Hook and structure.” Give “Final script” the reviewed versions, closed findings, remaining limits, and pending decisions so the consolidated script preserves one factual and timing baseline.`,
  },
  'final-script': {
    zh: `## 填写前

本页把通过修订的旁白与分镜合成一份制作人员可按行执行的脚本。准备“旁白撰写”“分镜设计”和“时长事实品牌检查”的最新版本，确认是否还有阻碍交付的问题。缺少修订稿、声音试读或素材时如实列出，不以“最终”标题替代完成证据，也不把脚本交付写成视频已制作发布。

## 版本基准与制作规格

脚本版本：[填写版本与日期]；负责人：[填写姓名]；目标时长：[填写秒数]；画幅／语言：[填写规格]。列出采用的旁白、分镜和事实卡版本，以及声音、字幕、背景音乐、音效和交付文件需求。若中英文均制作，分别记录时间轴与试读状态，不假定翻译后时长相同。

## 合并制作表

沿用段落与镜头编号，按时间顺序合并逐字旁白、可执行画面、屏幕文字、声音提示及素材来源。制作提示与朗读内容分列。图像、旁白及字幕同步出现时使用同一窗口；转场与停留时间必须有明确位置。把整条视频的所有镜头都放入本表，不能只粘贴开场示例。

| 时间／镜头 | 逐字旁白 | 画面动作 | 屏幕文字／字幕 | 音乐、音效与转场 | 素材／事实卡 |
| --- | --- | --- | --- | --- | --- |
| [填写起止秒及编号] | [填写正文或无旁白] | [填写具体镜头] | [填写逐字文案] | [填写提示及时间] | [填写实际来源或待提供] |

## 修订闭环与交付说明

逐条记录审校问题的处理、修改位置与回查结果；保留尚未确认项的负责人和影响。给制作人员列出必用素材、替代素材、发音表、示意标注及不能擅改的事实限定。汇总实际计时或估算依据、待试读范围和人工审阅状态。若临时换素材或删句会改变含义、时长或品牌表达，明确需要回查对应项。

## 填写示例

虚构合稿行：39—45 秒／S-06，旁白“选一个任务，现在把第一步写下来。”画面保持三步清单，并突出第一行；字幕与旁白一致；音乐逐渐减弱，45 秒结束。来源栏填“示意清单，拟制作；无量化事实主张”。若该句尚未用选定声音试读，计时状态写“窗口预算，待试读”，不能记成“实测 6 秒”。

## 完成检查

- [ ] 全部镜头已合并，旁白、画面、字幕与声音提示可按行执行。
- [ ] 总时间轴与规格一致，试读证据或尚未测量的范围已列明。
- [ ] 审校问题逐项处置，素材、事实限定及示意标注未在合稿中丢失。
- [ ] 交付版本、未决事项和人工审阅状态清晰，未声称完成制片或发布。

## 文档衔接

接收“旁白撰写”“分镜设计”的修订内容和“时长事实品牌检查”的结论。涉及事实变化时回查“事实研究”，重大定位变化回查“创意简报”。本页是本模板脚本交付终点，将完整制作表、资产状态与未决事项提供给后续人工制片前审阅；实际配音、剪辑和成片验收另行记录。`,
    en: `## Before you start

Combine revised narration and shots into a production script that can be executed row by row. Prepare the latest “Write voiceover,” “Design storyboard,” and “Duration, fact, and brand check.” Identify remaining delivery blockers. Record missing revisions, voice readings, or assets honestly. A “final” title does not establish readiness, and a script handoff does not establish that a video was produced or published.

## Version baseline and production specifications

Script version: [Enter version and date]. Owner: [Enter name]. Target duration: [Enter seconds]. Ratio and language: [Enter specifications]. Identify adopted narration, storyboard, and fact-card versions. Record voice, caption, background music, sound-effect, and output requirements. If producing both languages, maintain separate timing and reading records rather than assuming translated lines have equal duration.

## Consolidated production table

Preserve beat and shot IDs. Combine exact narration, executable visual actions, screen text, audio cues, and source references chronologically. Separate spoken text from production notes. Use a shared window for simultaneous imagery, speech, and captions, locating every transition and hold. Include the complete video, not just an opening example.

| Time and shot | Exact narration | Visual action | Screen text and captions | Music, effects, and transitions | Assets and fact cards |
| --- | --- | --- | --- | --- | --- |
| [Enter times and ID] | [Enter spoken text or no narration] | [Enter executable shot] | [Enter exact wording] | [Enter cues and timing] | [Enter actual source or pending] |

## Review closure and production handoff

Record the treatment, revised location, and recheck result for each finding. Keep pending decisions with owners and impacts. Supply required assets, alternatives, pronunciations, illustrative labels, and factual qualifiers that must survive production. Summarize measured timing or estimation basis, untested sections, and human-review status. Identify which checks must be repeated if replacement assets or cuts change meaning, timing, or brand expression.

## Worked example

Fictional consolidated row: 39–45 seconds/S-06, narration “Choose one task. Write down its first step now.” Hold the three-step list and highlight the first line; captions match narration. Fade the music toward the end at 45 seconds. Record the asset as “illustrative list to create; no quantitative claim.” Until the chosen voice has been timed, mark “budgeted window, reading pending,” not “measured at six seconds.”

## Completion checklist

- [ ] Every shot is consolidated with executable narration, visuals, captions, and audio cues.
- [ ] Timing matches specifications; readings or unmeasured scope are documented.
- [ ] Findings are addressed without losing sources, qualifiers, or illustrative labels.
- [ ] Version, open decisions, and human-review status are clear without claiming production or publication.

## Related documents

Receive revised material from “Write voiceover” and “Design storyboard” and conclusions from “Duration, fact, and brand check.” Revisit “Fact research” for changed claims and “Creative brief” for major positioning changes. This is the template's script handoff endpoint: provide the complete production table, asset statuses, and open decisions for human pre-production review. Recording, editing, and finished-video acceptance need their own evidence.`,
  },
};
