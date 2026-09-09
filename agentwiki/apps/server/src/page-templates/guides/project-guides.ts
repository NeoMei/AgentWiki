/** Human-fillable project documents. Examples are fictional and never project facts. */
export const projectGuides: Record<string, { zh: string; en: string }> = {
  'project-overview': {
    zh: `## 填写前

本页用来让第一次接触项目的人理解为什么做、交付什么、由谁验收。先收集立项说明、用户反馈和已确认的资源约束；口头意见请记录提出人和日期。尚未确认的信息写明“待确认 + 负责人 + 确认日期”，不要替利益相关方作承诺。

## 背景与目标

用一个真实场景描述谁遇到什么问题、现有做法为什么不够。把“提升效率”改成可以观察的变化；没有基线时先写测量计划。

- 目标用户与使用场景：[填写对象、触发时机和当前困难]
- 问题证据：[填写访谈、工单或数据出处及日期]
- 本次希望改变的结果：[填写目标及其业务意义]

| 目标 | 当前基线/测量计划 | 目标值与期限 | 验收方法 | 确认人 |
| --- | --- | --- | --- | --- |
| [填写可验证结果] | [填写来源或待测方法] | [填写] | [填写测试/观察方式] | [填写] |

## 范围与交付物

分别列出本期做和暂不做的内容，避免读者把愿景当作承诺。每个交付物应能被打开、演示或检查。

- 本期范围：[填写包含的用户、流程和交付物]
- 不在本期范围：[填写明确排除项及原因]
- 必须满足的约束：[填写预算、时间、依赖或兼容要求及来源]
- 验收方式：[填写谁在何种环境下检查哪些证据]

## 责任与决策方式

填写项目负责人、业务确认人、执行人员及各自可以决定的事项。涉及范围或期限变化时，先在“决策记录”中记录批准结果，再更新本页。

- 项目负责人/联系方式：[填写]
- 验收人及确认方式：[填写]
- 更新节奏与状态沟通位置：[填写]
- 尚待确认的关键问题：[逐项填写负责人和日期]

## 填写示例

以下为虚构示例，仅展示写法，不代表实际承诺：一个8人支持团队准备试用知识库，首期只整理20条常见问题；多语言与客户自助门户不在本期范围。目标暂定“试点人员可在2分钟内找到指定答案”，第一周先测量现状，再由业务负责人确认目标。验收材料包括20条经过核对的条目、查找任务记录和负责人签认。

## 完成检查

- [ ] 目标包含可验证的结果，基线未知时已列测量计划。
- [ ] 范围、排除项和交付物明确，验收人已确认或标出待确认。
- [ ] 每项关键约束有来源，未把示例数字保留为真实项目承诺。
- [ ] 负责人、更新时间和待确认事项都有下一步。

## 文档衔接

把已确认交付物交给“计划与里程碑”拆解，再在“任务清单”分配执行项。把假设和外部依赖录入“风险与阻塞”；范围调整引用“决策记录”的编号，避免多处出现不同承诺。`,
    en: `## Before you start

Use this page to explain why the project exists, what it will deliver and who accepts it. Gather the approved brief, user feedback and resource constraints. Record the speaker and date for verbal requirements. For unknowns, enter “unconfirmed”, an owner and a confirmation date instead of making commitments for someone else.

## Problem and outcomes

Describe a concrete user in a real situation: what are they trying to do, what happens today, and why is that inadequate? Replace “improve efficiency” with an observable outcome. If no baseline exists, record how it will be measured first.

- Users and triggering situation: [Enter the people, context and current difficulty]
- Evidence of the problem: [Enter source, date and relevant observation]
- Intended change: [Enter the outcome and why it matters]

| Outcome | Baseline or measurement plan | Target and deadline | Acceptance method | Approver |
| --- | --- | --- | --- | --- |
| [Enter a verifiable result] | [Enter source or method] | [Enter] | [Enter test or observation] | [Enter] |

## Scope and deliverables

Separate this iteration from the longer-term ambition. Describe deliverables that a reviewer can open, demonstrate or inspect.

- Included: [Enter users, processes and deliverables covered]
- Excluded for now: [Enter exclusions and the reason for each]
- Constraints: [Enter agreed budget, dates, dependencies and compatibility requirements, with sources]
- Acceptance: [Enter who checks which evidence in what environment]

## Ownership and decisions

Name the project owner, business approver and contributors, including what each can decide. Record approval of a scope or deadline change in “Decision log” before changing this page.

- Project owner and contact: [Enter]
- Acceptance owner and confirmation method: [Enter]
- Update cadence and status location: [Enter]
- Open questions: [Enter each question, owner and confirmation date]

## Worked example

Fictional example, not an actual commitment: an eight-person support team will trial a knowledge base containing twenty verified answers. Multilingual support and a customer portal are excluded. A proposed outcome is finding a specified answer within two minutes; the team first measures current performance and asks the business owner to confirm the target. Acceptance evidence consists of the reviewed answers, lookup-task records and the owner's decision.

## Completion checklist

- [ ] Outcomes are observable, with a baseline or a plan to measure it.
- [ ] Scope, exclusions and deliverables have an approver or an explicit pending decision.
- [ ] Constraints have sources; fictional example numbers are not retained as commitments.
- [ ] Ownership, update date and next steps for unknowns are recorded.

## Related documents

Pass confirmed deliverables to “Plan and milestones”, then allocate work in “Task list”. Capture assumptions and dependencies in “Risks and blockers”. Reference the relevant “Decision log” entry when changing scope so that the documents do not describe different commitments.`,
  },
  'plan-milestones': {
    zh: `## 填写前

本页把“项目概况”的目标变成可检查的阶段成果。准备已确认范围、交付日期、人员可用时间和外部依赖；没有确认的日期标为估算，并写明估算依据。里程碑是成果检查点，不是“开会”或“持续推进”这样的活动名称。

## 阶段与成果

按可独立验收的成果划分阶段。给每个里程碑一个编号，填写必须出现的产物与退出条件；下一阶段不要依赖含糊的“基本完成”。

| 编号 | 阶段成果 | 交付物 | 完成判据 | 负责人 | 计划日期/可信度 |
| --- | --- | --- | --- | --- | --- |
| [M-01] | [填写成果] | [填写可检查产物] | [填写谁检查什么] | [填写] | [填写已承诺/估算] |

## 依赖与资源

从最后期限倒推前置条件，检查同一人员是否在多个阶段被重复占用。外部团队的交付应包含确认人和最晚到位时间。

- 前置依赖：[编号、来源、最晚时间、确认状态]
- 可用人力与时间：[按实际可投入时间填写，区分等待与工作量]
- 关键路径：[填写一旦推迟就影响最终交付的阶段链]
- 预留缓冲：[说明用于哪些已识别不确定性，不隐藏在工期中]

## 跟踪与变更

保留原计划和当前预测，不要直接抹掉延期记录。记录偏差原因、影响的交付物和需要谁决定的取舍。

| 里程碑 | 原计划 | 当前预测 | 偏差原因/证据 | 恢复动作 | 决策编号 |
| --- | --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [填写] | [负责人+期限] | [填写或待确认] |

## 填写示例

虚构示例：知识库试点的M-01不是“整理资料”，而是“20条候选问题清单经支持负责人确认”。退出条件是每条问题有来源和编写责任人。若专家评审要等到下周，记录为外部依赖；是否改成先验收10条，应进入“决策记录”，不能自行更改承诺。

## 完成检查

- [ ] 每个里程碑都有可检查产物、负责人和退出条件。
- [ ] 时间承诺与估算已区分，依赖和人员容量得到核对。
- [ ] 原计划与当前预测都被保留，延期有证据与处理动作。
- [ ] 阶段安排能覆盖“项目概况”的全部交付物。

## 文档衔接

将阶段成果拆到“任务清单”，任务引用里程碑编号。把依赖不确定性转入“风险与阻塞”，在“进展记录”更新当前预测；获批调整引用“决策记录”。`,
    en: `## Before you start

Translate the outcomes in “Project overview” into inspectable stage results. Collect agreed scope, delivery dates, contributor availability and external dependencies. Label unconfirmed dates as estimates and explain their basis. A milestone is an outcome checkpoint, not an activity such as “hold a meeting” or “keep progressing”.

## Stages and exit criteria

Divide the work into results that can be accepted independently. Give each milestone an identifier, a tangible output and an exit condition. Avoid making the next stage depend on “mostly done”.

| ID | Stage outcome | Deliverable | Exit criterion | Owner | Date and confidence |
| --- | --- | --- | --- | --- | --- |
| [M-01] | [Enter result] | [Enter inspectable output] | [Enter reviewer and check] | [Enter] | [Committed or estimated] |

## Dependencies and capacity

Work backwards from the deadline and check whether the same contributor has been allocated incompatible work. For external deliveries, name the person confirming them and the latest useful arrival date.

- Prerequisites: [ID, source, required date and confirmation status]
- Available capacity: [Actual contributor time; separate effort from waiting time]
- Critical sequence: [Stages whose delay would move final delivery]
- Contingency: [Explain the identified uncertainty each buffer covers]

## Tracking and changes

Keep the original plan alongside the latest forecast. Do not erase evidence of a delay. Explain the cause, affected outputs and the trade-off requiring a decision.

| Milestone | Original plan | Current forecast | Cause and evidence | Recovery action | Decision ID |
| --- | --- | --- | --- | --- | --- |
| [Enter] | [Enter] | [Enter] | [Enter] | [Owner and date] | [Enter or pending] |

## Worked example

Fictional example: milestone M-01 is “the support owner approves a list of twenty candidate questions”, rather than “organize material”. Every question must have a source and a writing owner. If expert review is unavailable until next week, record that dependency. Reducing the initial delivery to ten questions requires an entry in “Decision log”; it is not an unannounced plan adjustment.

## Completion checklist

- [ ] Every milestone has an inspectable output, owner and exit condition.
- [ ] Commitments and estimates are distinguishable; dependencies and capacity have been checked.
- [ ] Original dates and forecasts remain visible, with evidence and actions for delays.
- [ ] The stages cover all deliverables in “Project overview”.

## Related documents

Break the stages down in “Task list” and reference milestone IDs from tasks. Move uncertain dependencies to “Risks and blockers”, update forecasts through “Progress log”, and reference “Decision log” for approved changes.`,
  },
  'task-list': {
    zh: `## 填写前

根据“计划与里程碑”拆出可以交接、检查和关闭的任务。先确认负责人是否有时间和权限完成任务。一个任务只保留一个最终负责者，协作者另列；不要把“持续关注”当作可关闭任务。

## 可执行任务

用“动词 + 对象 + 交付结果”命名任务，写清开始需要什么，以及什么证据表示完成。过大的任务按独立可验收结果继续拆分。

| 编号 | 任务与交付结果 | 对应里程碑 | 负责人/协作者 | 截止日期 | 状态 | 完成证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [T-01] | [填写具体结果] | [M-编号] | [填写] | [填写] | [待开始/进行中/阻塞/待验收/完成] | [填写链接或待提供] |

## 开始与完成条件

为需要跨人交接的任务补充以下小卡片，可复制多份。不要仅凭执行者说“做了”就关闭任务。

- 任务编号：[填写]
- 开始条件：[填写前置任务、材料、权限和工具]
- 完成标准：[填写验收者可复核的行为或产物]
- 验收者与反馈期限：[填写]
- 当前下一步：[填写一个具体动作及时间]

## 排序与阻塞

优先考虑交付依赖和实际风险，说明为何某任务要先做。未到截止日期也可能已经阻塞；记录卡在哪里、等谁、何时升级处理。

| 任务 | 依赖/阻塞点 | 需要的帮助 | 处理负责人 | 最晚响应时间 |
| --- | --- | --- | --- | --- |
| [填写] | [填写缺少什么] | [填写要作出的决定或交付] | [填写] | [填写] |

## 填写示例

虚构示例：把“完善知识库”拆为T-01“核对退款问题的来源并提交初稿”。开始条件是得到当前退款规则；完成证据是初稿链接、来源日期和评审意见。文稿写完但尚未评审时状态为“待验收”，不能算“完成”；规则未拿到则记为“阻塞”。

## 完成检查

- [ ] 每个任务都有单一负责人、可验收结果与截止日期或排期条件。
- [ ] 任务能追溯到里程碑，开始条件与完成标准明确。
- [ ] “完成”状态附有实际证据，未把提交等同于验收通过。
- [ ] 阻塞项有求助对象和最晚响应时间，取消任务保留原因。

## 文档衔接

任务编号用于“进展记录”汇总，不复制整份清单。影响阶段日期时更新“计划与里程碑”；持续性阻塞转入“风险与阻塞”，改变范围或优先级的决定记入“决策记录”。`,
    en: `## Before you start

Break down “Plan and milestones” into tasks that can be handed over, inspected and closed. Confirm that owners have the time and authority to do the work. Give each task one accountable owner and list collaborators separately. “Keep an eye on it” is not a closeable task.

## Executable work items

Name a task with a verb, an object and a delivered result. State what is needed to begin and what evidence proves completion. Split large tasks by independently acceptable outcomes.

| ID | Task and deliverable | Milestone | Owner and collaborators | Due date | Status | Completion evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [T-01] | [Enter result] | [M-ID] | [Enter] | [Enter] | [Not started / In progress / Blocked / Awaiting acceptance / Done] | [Enter reference or pending] |

## Entry and completion conditions

Copy this small task card for work that crosses people or teams. A claim that an action was performed is not sufficient evidence to close a task.

- Task ID: [Enter]
- Ready to start when: [Prerequisite work, material, permissions and tools]
- Completion criterion: [Behavior or output a reviewer can verify]
- Acceptance owner and response date: [Enter]
- Immediate next action: [One action and when it will happen]

## Order and blockers

Explain ordering through delivery dependencies and actual risk. A task may already be blocked before its due date: record what is missing, who can provide it and when escalation is needed.

| Task | Dependency or blocker | Help required | Resolution owner | Latest response |
| --- | --- | --- | --- | --- |
| [Enter] | [What is missing] | [Decision or deliverable needed] | [Enter] | [Enter] |

## Worked example

Fictional example: replace “improve the knowledge base” with T-01, “verify the source for the refund answer and submit a draft”. The current refund policy is an entry condition. Evidence includes the draft reference, policy date and review comments. A written draft awaiting review is “Awaiting acceptance”, not “Done”; a missing policy is a blocker.

## Completion checklist

- [ ] Every task has one owner, an acceptable output and a due date or scheduling condition.
- [ ] Tasks trace to milestones and define entry and completion conditions.
- [ ] Done items have evidence; submission has not been mistaken for acceptance.
- [ ] Blockers name the required help and response date; cancelled tasks retain their reason.

## Related documents

Summarize task IDs in “Progress log” instead of duplicating the entire list. Update “Plan and milestones” if stage dates change. Escalate persistent blockers in “Risks and blockers” and record scope or priority decisions in “Decision log”.`,
  },
  'risks-blockers': {
    zh: `## 填写前

检查目标、排期、外部依赖和最近的执行反馈。风险是尚未发生但可能影响目标的事件；阻塞是已经妨碍当前工作的事实。不要把二者混在“有风险”一句话里。评估依据不足时写明未知，不用精确数字制造确定性。

## 风险登记

用“如果某事件发生，将通过某原因影响某交付物”的句式描述风险。发生可能性与影响等级可自定，但全表应采用同一口径并说明依据。

| 编号 | 风险事件与原因 | 受影响目标 | 可能性/依据 | 影响 | 触发信号 | 负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| [R-01] | [填写尚未发生的事件] | [目标/里程碑] | [填写高/中/低及理由] | [填写范围/时间/质量影响] | [填写可观察信号] | [填写] |

## 预防与应对

分别记录事件发生前可以采取的预防动作、发生后可执行的替代方案，以及决定何时切换方案的人。避免把“加强沟通”当作唯一应对。

- 关联风险：[R-编号]
- 预防动作：[负责人、具体动作、期限和证据]
- 触发后的应对：[可执行的替代路径及代价]
- 需要批准的取舍：[范围、日期、资源及批准人]
- 下次复查日期：[填写]

## 当前阻塞与升级

| 阻塞事实/首次发现时间 | 受阻任务 | 已尝试动作 | 需要谁提供什么 | 最晚响应时间 | 状态/解除证据 |
| --- | --- | --- | --- | --- | --- |
| [填写可核实事实] | [T-编号] | [填写] | [填写] | [填写] | [填写] |

只有当所需材料、权限或决策确实到位，才能标记解除；风险关闭则应注明已经消失、已发生转问题、或被接受的理由。

## 填写示例

虚构示例：R-01“唯一退款规则评审人下周可能休假，将延迟首批内容验收”。预防动作是本周确认备选评审人；触发信号是两天内仍无确认。若规则文件已无法访问，则另建阻塞项，记录受阻任务、权限申请编号和需要响应的人，不再称为未来风险。

## 完成检查

- [ ] 风险与已发生阻塞分开，受影响目标和证据明确。
- [ ] 高影响项有触发信号、负责人和可执行应对。
- [ ] 阻塞项说明需要谁提供什么、何时必须响应。
- [ ] 已关闭事项保留关闭理由、日期和解除证据。

## 文档衔接

从“项目概况”和“计划与里程碑”取风险影响对象，把应对动作放入“任务清单”。需要接受风险或更改承诺时提交“决策记录”；在“进展记录”只汇报变化与需要帮助的事项。`,
    en: `## Before you start

Review outcomes, dates, dependencies and recent execution feedback. A risk is an event that might affect an objective; a blocker is a fact already preventing work. Keep them distinct. When evidence is insufficient, record uncertainty rather than assigning a falsely precise probability.

## Risk register

Use “If this event occurs, it will affect this deliverable because…” to explain each risk. You may choose a qualitative scale, but apply it consistently and state the basis of each assessment.

| ID | Event and cause | Outcome affected | Likelihood and basis | Impact | Observable trigger | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| [R-01] | [Future event] | [Outcome or milestone] | [High/medium/low and why] | [Scope/time/quality effect] | [Enter signal] | [Enter] |

## Prevention and response

Separate actions before an event from the fallback after it occurs. Identify who decides to switch plans. “Communicate more” is not a sufficient response without a concrete action.

- Risk reference: [R-ID]
- Prevention: [Owner, action, date and evidence]
- Contingency: [Executable alternative and its cost]
- Trade-off requiring approval: [Scope, dates, resources and approver]
- Next review date: [Enter]

## Current blockers and escalation

| Blocking fact and first observed date | Task blocked | Attempts made | Who must provide what | Latest response | Status and resolution evidence |
| --- | --- | --- | --- | --- | --- |
| [Verifiable fact] | [T-ID] | [Enter] | [Enter] | [Enter] | [Enter] |

Close a blocker only when the missing material, permission or decision has arrived. When closing a risk, state whether it disappeared, occurred and became an issue, or was explicitly accepted.

## Worked example

Fictional example: R-01 is “the only refund-policy reviewer may be absent next week, delaying initial content acceptance”. Confirming a backup reviewer this week is prevention; no confirmation after two days is a trigger. If the policy file is already inaccessible, create a blocker with the affected task, access-request reference and response owner instead of calling it a future risk.

## Completion checklist

- [ ] Future risks and current blockers are distinct, with affected outcomes and evidence.
- [ ] High-impact items have triggers, owners and executable responses.
- [ ] Blockers specify who needs to provide what and by when.
- [ ] Closed items retain the reason, date and resolution evidence.

## Related documents

Use “Project overview” and “Plan and milestones” to identify affected outcomes. Add mitigation actions to “Task list”. Submit acceptance of risk or changed commitments to “Decision log”. Summarize changes and requests for help in “Progress log”.`,
  },
  'decision-log': {
    zh: `## 填写前

本页记录影响范围、资源、日期或方案的实际决策，帮助后来的人理解当时为什么这样选。先准备待决问题、可选方案、证据和有权批准的人。讨论意见、建议和已批准决定必须分开，尚未拍板时明确写“待决定”。

## 待决问题与约束

每个决策复制一份记录，编号持续递增。说明如果不作决定会影响什么，不要只写会议主题。

- 决策编号/提出日期：[D-编号 / 日期]
- 需要决定的问题：[填写具体选择]
- 背景与证据：[填写事实、来源、日期和未知项]
- 必须满足的约束：[填写不可忽略的边界及来源]
- 决策人/最晚决定时间：[填写]

## 方案比较

至少比较当前可行选项；“保持现状/暂缓”若可行也应列出。使用相同标准比较，避免一方写优势、另一方只写缺点。

| 方案 | 目标收益 | 成本与风险 | 对范围/日期影响 | 证据与不确定性 |
| --- | --- | --- | --- | --- |
| [方案A] | [填写] | [填写] | [填写] | [填写] |
| [方案B] | [填写] | [填写] | [填写] | [填写] |

## 决定与执行

- 状态：[待决定/已批准/已撤销/已被替代]
- 最终决定及理由：[填写取舍依据，保留未选择方案的原因]
- 批准人、时间与确认记录：[填写可追溯证据]
- 执行动作：[负责人、期限和受影响文档]
- 重新评估条件：[哪些新证据或变化会使本决定失效]
- 替代关系：[若替代旧决定，写旧编号而不删除历史]

## 填写示例

虚构示例：D-02需要决定试点是否包含多语言。方案A为首期加入，收益是覆盖更多用户，但需额外翻译和评审；方案B为先交付中文20条并收集需求。负责人批准B，理由是先验证查找流程；“外语工单达到经确认的需求门槛”触发重新评估。若尚未得到负责人确认，应保留“待决定”，不能把推荐方案写成最终决定。

## 完成检查

- [ ] 问题、可选项及比较标准清晰，有依据支持关键取舍。
- [ ] 推荐与批准结果区分，批准记录可追溯。
- [ ] 执行动作有负责人和期限，受影响文档已列明。
- [ ] 旧决定未被覆盖，复查条件或替代关系完整。

## 文档衔接

批准后更新“项目概况”的范围、“计划与里程碑”的日期和“任务清单”的动作，均注明D-编号。尚未批准且可能影响进度的问题进入“风险与阻塞”，在“进展记录”提出决策请求。`,
    en: `## Before you start

Record actual decisions affecting scope, resources, dates or approach so later readers can understand the trade-offs. Gather the question, viable options, evidence and the authorized approver. Distinguish discussion, recommendation and approval; use “Pending” until a decision has actually been made.

## Question and constraints

Copy a record for each decision and keep identifiers stable. Explain the consequence of delaying the decision instead of using only a meeting subject.

- Decision ID and proposed date: [D-ID / date]
- Question to resolve: [Enter the concrete choice]
- Context and evidence: [Facts, sources, dates and unknowns]
- Constraints: [Boundaries the choice must respect and their sources]
- Decision owner and latest decision date: [Enter]

## Compare options

Compare viable choices using the same criteria. Include doing nothing or deferring when that is a real option. Do not list only benefits for a preferred option and only drawbacks for alternatives.

| Option | Intended benefit | Cost and risk | Scope or date impact | Evidence and uncertainty |
| --- | --- | --- | --- | --- |
| [Option A] | [Enter] | [Enter] | [Enter] | [Enter] |
| [Option B] | [Enter] | [Enter] | [Enter] | [Enter] |

## Decision and follow-through

- Status: [Pending / Approved / Withdrawn / Superseded]
- Decision and rationale: [Trade-offs and reasons for rejecting alternatives]
- Approver, date and confirmation record: [Traceable evidence]
- Actions: [Owner, due date and documents affected]
- Revisit condition: [New evidence or changes that would invalidate the choice]
- Superseded decision: [Reference the old ID rather than deleting it]

## Worked example

Fictional example: D-02 asks whether multilingual content belongs in the first trial. Option A broadens user coverage but needs additional translation and review. Option B ships twenty Chinese answers first to validate the lookup process. The owner approves B, with a confirmed foreign-language demand threshold as the trigger to reconsider. Until that owner confirms, the record remains “Pending”; a recommendation is not a decision.

## Completion checklist

- [ ] The question, options and comparison criteria are clear and supported by evidence.
- [ ] Recommendation and approval are distinct, and approval is traceable.
- [ ] Follow-through actions have owners and dates, with affected documents identified.
- [ ] Earlier decisions remain available, including revisit or supersession references.

## Related documents

After approval, update scope in “Project overview”, dates in “Plan and milestones”, and actions in “Task list”, citing the D-ID. Unresolved decisions threatening delivery belong in “Risks and blockers”; request decisions through “Progress log”.`,
  },
  'progress-log': {
    zh: `## 填写前

每次更新先收集任务完成证据、里程碑预测和新增阻塞。本页用于帮助读者判断项目是否按约定推进、现在需要什么帮助，不是每日动作流水账。保留以前的更新，最新记录放在前面；无法测量的百分比不要估写。

## 本期概况

- 汇报区间/更新人：[开始日期—结束日期 / 姓名]
- 当前状态：[按计划/有偏差/已阻塞，并用一句事实解释]
- 相对上期的关键变化：[填写结果或预测变化，不重复项目背景]
- 当前交付预测：[填写日期、依据及未确认因素]

## 结果与证据

只把有完成依据的结果放在“已完成”。区分已执行、已提交、已验收三个状态，证据可以是可打开的产物或验收记录。

| 任务/里程碑 | 本期结果 | 当前状态 | 可核查证据 | 相比计划的偏差 |
| --- | --- | --- | --- | --- |
| [T-/M-编号] | [填写具体变化] | [填写] | [填写链接/记录和日期] | [填写或无] |

## 下一步与求助

- 下期最重要的交付：[结果、负责人、期限、完成标准]
- 影响预测的风险/阻塞：[R-编号或具体事实]
- 需要的决定/协助：[谁在何时提供什么，若不响应会怎样]
- 已采取的恢复动作：[填写动作及可观察效果，未验证时注明]

将一般讨论与需要明确回应的请求分开。若确实没有阻塞，写“截至本次更新未发现”，不要把它当作永久无风险的保证。

## 填写示例

虚构示例：截至周五，20条候选问题中12条已提交，其中8条获得评审确认。应写“8条已验收、4条待评审”，不写“完成60%”。因评审人下周缺席，需要项目负责人周一前确认备选人；若未确认，M-02预计延后两天，具体调整仍待批准。

## 完成检查

- [ ] 更新注明时间区间和作者，结果能追溯到任务或里程碑。
- [ ] 已完成、待验收与计划动作分开，不用无依据百分比掩盖状态。
- [ ] 当前预测反映已知偏差，关键求助有对象和响应期限。
- [ ] 历史记录保留，正文没有把虚构示例当成本期事实。

## 文档衔接

以“任务清单”为执行事实来源，用“计划与里程碑”核对偏差。把新风险更新到“风险与阻塞”，需要取舍的问题进入“决策记录”。阶段结束后，将结果和偏差证据交给“项目复盘”。`,
    en: `## Before you start

Collect task evidence, milestone forecasts and new blockers before each update. This page tells readers whether delivery is on track and what help is needed; it is not a diary of activity. Keep older updates and place the newest first. Do not invent a percentage when progress has no meaningful denominator.

## Reporting period

- Period and author: [Start date—end date / name]
- Status: [On plan / Deviating / Blocked, followed by a factual explanation]
- Main change since the last update: [Outcome or forecast change, not repeated background]
- Current delivery forecast: [Date, basis and unconfirmed factors]

## Results and evidence

List results as completed only when completion is supported. Distinguish work performed, work submitted and work accepted. Evidence may be an accessible deliverable or an acceptance record.

| Task or milestone | Result this period | Current status | Verifiable evidence | Deviation from plan |
| --- | --- | --- | --- | --- |
| [T-/M-ID] | [Specific change] | [Enter] | [Reference and date] | [Enter or none] |

## Next actions and help needed

- Most important next output: [Result, owner, date and completion criterion]
- Risk or blocker affecting the forecast: [R-ID or observed fact]
- Decision or assistance required: [Who must provide what by when, and consequence of no response]
- Recovery action already taken: [Action and observed effect; label effects not yet verified]

Separate general discussion from requests requiring a response. If no blockers are known, write “None identified as of this update”; that is not a promise that future risk is absent.

## Worked example

Fictional example: by Friday, twelve of twenty candidate answers have been submitted and eight have been accepted. Report “eight accepted, four awaiting review”, not “60% complete”. The reviewer will be absent next week, so the project owner must confirm a backup by Monday. Without a backup, M-02 is forecast to slip by two days; the adjustment still needs approval.

## Completion checklist

- [ ] The period and author are clear, and results reference tasks or milestones.
- [ ] Completed, awaiting acceptance and planned work are distinct; percentages have a defensible basis.
- [ ] Forecasts reflect known deviations and important requests have owners and deadlines.
- [ ] Earlier updates remain available and fictional examples are not reported as current facts.

## Related documents

Use “Task list” as the execution source and “Plan and milestones” to assess deviations. Update “Risks and blockers” when new issues appear and take trade-offs to “Decision log”. Pass result and deviation evidence to “Project retrospective” at the end of a stage.`,
  },
  retrospective: {
    zh: `## 填写前

在一个阶段或项目结束时，带着“项目概况”的验收目标、实际交付、进展记录和决策记录来复盘。讨论具体事件及其影响，区分事实、解释与尚未验证的猜测。复盘用于改变下一次的做法，不用于给个人贴标签。

## 目标与实际

先确认交付是否验收，再比较目标和实际。未测量的效果明确写“尚无数据”，不要用主观印象代替结果。

| 原目标/交付物 | 实际结果与证据 | 差异 | 原因假设 | 尚需核实 |
| --- | --- | --- | --- | --- |
| [来自项目概况] | [填写验收/测量记录] | [填写] | [区分已证实与猜测] | [填写或无] |

## 关键事件与机制

选择最值得学习的两三件事，既包括有效做法也包括失误。沿时间顺序追溯当时掌握的信息、作出的决定和后果，避免用事后已知信息苛责当时的人。

- 事件与时间：[填写可核实事实]
- 当时的信息和约束：[填写]
- 对结果的影响：[填写证据及不确定性]
- 应保留或改变的工作方式：[说明为什么有效或失效]

## 改进行动与复查

把“加强意识”转成下次能检查的改动。一次只承诺有资源落实的动作；同时记录不采取行动的理由。

| 改进行动 | 负责人 | 期限 | 如何验证有效 | 复查日期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| [填写可执行改变] | [填写] | [填写] | [填写观察指标/证据] | [填写] | [填写] |

## 填写示例

虚构示例：试点20条内容已经验收，但查找任务未计时，因此“更容易找到答案”仍是待验证判断。一个明确问题是评审安排过晚导致等待。改进行动是“下个阶段排期前确认主评审和备选人”，由项目负责人负责，下次复查看是否仍出现等待；不能只写“提高协作效率”。

## 完成检查

- [ ] 目标与实际均有依据，未测结果清楚标注。
- [ ] 事实与原因假设分开，讨论流程和约束而非个人标签。
- [ ] 有效实践和需改进事项都有具体事件支撑。
- [ ] 改进行动有负责人、期限、验证方法和复查安排。

## 文档衔接

从“进展记录”和“决策记录”引用证据，不重新编造历史。将获同意的改进行动加入下一阶段“任务清单”，必要时调整“计划与里程碑”；改变目标或范围仍需更新“项目概况”并保留批准依据。`,
    en: `## Before you start

At the end of a stage or project, bring acceptance goals from “Project overview”, actual deliverables, progress updates and decisions. Discuss specific events and their effects. Separate facts, explanations and untested hypotheses. The purpose is to change future practice, not attach labels to individuals.

## Intended and actual outcomes

Confirm acceptance before comparing intended and actual results. When an outcome was never measured, say “No data yet” rather than substituting an impression.

| Original outcome or deliverable | Actual result and evidence | Difference | Explanation or hypothesis | Still to verify |
| --- | --- | --- | --- | --- |
| [From Project overview] | [Acceptance or measurement record] | [Enter] | [Mark confirmed versus hypothesized] | [Enter or none] |

## Events and underlying practices

Choose two or three useful learning events, including successes and problems. Reconstruct what people knew, what they decided and what happened next. Avoid judging an earlier choice as if later information were already available.

- Event and date: [Verifiable facts]
- Information and constraints at the time: [Enter]
- Effect on the outcome: [Evidence and uncertainty]
- Practice to retain or change: [Explain why it helped or failed]

## Improvement actions and follow-up

Turn “raise awareness” into a change that can be checked next time. Commit only to actions the team can resource, and record reasons for deciding not to act.

| Improvement action | Owner | Due date | How effectiveness will be verified | Review date | Status |
| --- | --- | --- | --- | --- | --- |
| [Executable change] | [Enter] | [Enter] | [Indicator or evidence] | [Enter] | [Enter] |

## Worked example

Fictional example: twenty trial answers were accepted, but lookup tasks were not timed, so “answers are easier to find” remains unverified. A documented problem was waiting caused by late reviewer scheduling. An action is “confirm a primary and backup reviewer before planning the next stage”, owned by the project lead, with waiting time checked at the next review. “Improve collaboration efficiency” alone is not an actionable conclusion.

## Completion checklist

- [ ] Intended and actual outcomes have evidence, and unmeasured outcomes are explicit.
- [ ] Facts and causal hypotheses are separate; discussion focuses on practices and constraints.
- [ ] Practices to retain and problems to fix are supported by specific events.
- [ ] Improvement actions have owners, dates, verification methods and follow-up arrangements.

## Related documents

Reference evidence from “Progress log” and “Decision log” rather than rewriting history. Add agreed improvements to the next “Task list” and adjust “Plan and milestones” where needed. Changes to goals or scope still require updating “Project overview” with the relevant approval.`,
  },
};
