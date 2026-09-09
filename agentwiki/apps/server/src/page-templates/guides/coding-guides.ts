export const codingGuides: Record<string, { zh: string; en: string }> = {
  'requirements-analysis': {
    zh: `## 填写前
本页把开发诉求转成可验证的需求边界，供实施者和验收者使用。准备项目说明、用户反馈、相关页面或接口、仓库地址与完整基线提交 SHA。分析阶段记录事实和决策，不直接修改仓库。缺少材料时写“待确认”、问题负责人和所阻塞的决策，不把推测写成现状。

## 问题与现状
- 目标用户与使用场景：[填写谁在什么情况下遇到什么问题]
- 当前行为与证据：[填写复现步骤、观察日期及可访问的记录位置]
- 期望变化与价值：[填写用户完成任务后应获得的结果]
- 分析基线：[填写仓库、分支、完整提交 SHA；存在未提交修改时说明范围]
区分用户原话、观察到的行为和自己的解释；说明问题出现频率以及影响范围，避免只用“优化体验”描述目标。

## 范围与约束
| 范围项 | 本次包含的行为 | 不包含的行为 | 约束与来源 |
| --- | --- | --- | --- |
| [填写功能或流程] | [填写起点与终点] | [填写边界] | [填写兼容性、权限或数据约束] |
检查仓库内受影响的组件、接口和数据，记录定位依据。列出必须保留的旧行为；涉及历史数据、权限或多语言时，分别写清边界，不用一句“兼容现有功能”代替。

## 可验收的需求
| 需求编号 | 前置条件与操作 | 预期可观察结果 | 验证方式 |
| --- | --- | --- | --- |
| REQ-01 | [填写身份、数据和操作] | [填写页面、返回值或状态变化] | [填写测试或人工检查] |
为正常路径、无权限、空数据和失败恢复分别补充适用条件。性能要求必须有样本规模、环境和阈值来源；未确定的指标标记待确认。本页写验收标准，不预先填写实际测试通过。

## 未决问题与依赖
- 问题：[填写]；可选方案及代价：[填写]；决策人和时间：[填写]
- 外部依赖：[填写提供方、所需输入、可用时间及缺失影响]
- 风险：[填写触发条件、受影响需求和验证办法]
注明哪些事项可在假设成立时推进，哪些必须先获得明确答案；需求变更需保留旧编号并说明对验收条件的影响。

## 填写示例
以下为虚构场景，仅示范填写方法，并非实际仓库或测试结果：用户在保存草稿失败后丢失输入。REQ-01 写为“已有编辑权限的用户输入正文，保存请求失败时，正文仍保留且页面显示可重试状态”。离线同步暂不纳入；失败后保留多久列为待确认，由产品负责人决定。完整基线 SHA 尚未取得，标为待补，不能声称已确认代码原因。

## 完成检查
- [ ] 问题有复现材料，事实与假设已分开。
- [ ] 每条需求都有编号、条件和可观察的验收结果。
- [ ] 范围、兼容约束和未决事项均有明确负责人或来源。
- [ ] 仓库基线可定位，缺失材料没有被写成已验证事实。

## 文档衔接
向实施计划传递需求编号、验收表、基线与未决依赖；向运行测试提供预期行为和边界条件。Agent 代码审校使用本页检查实现是否符合已确认范围。后续需求变化先更新本页，再通知这些文档的维护者。`,
    en: `## Before you start
Use this page to turn a development request into verifiable requirements for implementers and reviewers. Collect the project brief, user feedback, relevant screens or interfaces, repository reference, and full baseline commit SHA. Record facts and decisions without modifying the repository during analysis. If an input is missing, write “Pending confirmation,” name its owner, and identify the decision it blocks; do not present assumptions as current behavior.

## Problem and current behavior
- User and scenario: [Enter who encounters which problem and when]
- Current behavior and evidence: [Enter reproduction steps, observation date, and accessible evidence location]
- Desired outcome and value: [Enter what the user should be able to accomplish]
- Analysis baseline: [Enter repository, branch, and full commit SHA; identify any uncommitted changes]
Separate user statements, direct observations, and your interpretation. Describe frequency and impact rather than using a general objective such as “improve the experience.”

## Scope and constraints
| Scope item | Included behavior | Excluded behavior | Constraint and source |
| --- | --- | --- | --- |
| [Enter feature or flow] | [Enter starting and ending states] | [Enter boundary] | [Enter compatibility, permission, or data constraint] |
Identify the affected components, interfaces, and data, together with the evidence used to locate them. List existing behavior that must remain intact. Specify historical-data, permission, and language boundaries separately when relevant; “preserve compatibility” alone is insufficient.

## Acceptance requirements
| Requirement ID | Preconditions and action | Expected observable outcome | Verification method |
| --- | --- | --- | --- |
| REQ-01 | [Enter identity, data, and action] | [Enter screen, response, or state change] | [Enter test or manual check] |
Cover the normal path, unauthorized access, empty data, and recovery from failure where applicable. Performance requirements need a dataset size, environment, and sourced threshold. Mark undecided metrics as pending. This page defines acceptance criteria; it does not claim that tests have passed.

## Open decisions and dependencies
- Question: [Enter]; options and tradeoffs: [Enter]; decision owner and due date: [Enter]
- External dependency: [Enter provider, required input, availability, and impact if unavailable]
- Risk: [Enter trigger, affected requirements, and verification approach]
Distinguish work that may proceed under a stated assumption from work awaiting an explicit answer. Retain requirement IDs when scope changes and explain the effect on acceptance criteria.

## Worked example
Fictional scenario for illustration only; this is not repository evidence or a test result: a user loses draft text after a failed save. REQ-01 states, “When an authorized editor enters text and the save request fails, the text remains visible and the page offers a retry.” Offline synchronization is excluded. Retention duration is an open decision for the product owner. The full baseline SHA is still missing, so the cause in the code remains unconfirmed.

## Completion checklist
- [ ] The problem has reproduction evidence, with facts separated from assumptions.
- [ ] Each requirement has an ID, conditions, and an observable acceptance outcome.
- [ ] Scope, compatibility constraints, and unresolved decisions have owners or sources.
- [ ] The repository baseline is identifiable; missing inputs are not described as verified facts.

## Related documents
Pass requirement IDs, the acceptance table, baseline, and unresolved dependencies to Implementation plan. Supply expected behavior and boundary conditions to Run tests. Agent code review uses this page to assess scope compliance. Update this page first when requirements change, then notify the owners of those documents.`,
  },
  'implementation-plan': {
    zh: `## 填写前
本页把已确认需求拆成可执行、可验证、可集成的工作。准备需求分析、仓库完整基线 SHA、开发约束及现有测试入口。需求或接口尚未确认时标记待定及负责人，并说明会阻塞哪项任务；不要通过计划默默扩大范围。

## 工作拆分与责任
| 工作项 | 对应需求 | 输入与产出 | 负责人 | 完成条件 |
| --- | --- | --- | --- | --- |
| 模块 A：[填写] | [填写编号] | [填写接口或补丁] | [填写] | [填写可验证结果] |
| 模块 B：[填写] | [填写编号] | [填写接口或补丁] | [填写] | [填写可验证结果] |
A、B 只是本次任务的任意分区标签，可按业务能力、数据处理或其他清晰边界划分，不默认代表前端和后端。写清各自负责与不负责的文件、行为及共享区域；同一文件由谁整合必须明确。

## 接口与执行顺序
- 基线与工作位置：[填写完整提交 SHA、工作区和分支]
- 接口约定：[填写输入、输出、错误语义、版本与约定位置]
- 依赖顺序：[填写哪些先完成、哪些可独立推进、每次交接内容]
- 集成负责人及顺序：[填写补丁组合顺序、共享文件冲突处理者]
接口改变时，列出另一模块需要同步修改的内容。安排先验证契约再整合行为，并说明集成失败如何退回上一可用修订，避免覆盖他人尚未提交的内容。

## 验证计划
| 验收编号 | 验证层次 | 运行入口与前置条件 | 预期结果 | 计划执行人 |
| --- | --- | --- | --- | --- |
| [填写 REQ 编号] | [填写单元、集成或人工验收] | [填写项目已有命令或步骤] | [填写可观察结果] | [填写] |
针对行为变更，安排能暴露原问题的测试及修复后回归；记录为何该测试能区分正确与错误实现。分别安排模块测试、A/B 集成与实际用户操作，不能用单模块通过代替整体通过。

## 风险与交付门槛
- 风险与缓解：[填写触发条件、影响及处理方式]
- 测试数据或环境缺口：[填写补齐负责人和时间]
- 审校入口：[填写基线、候选修订与审校范围的交付方式]
- 交付门槛：[填写必须通过的检查、可接受残余风险及确认人]
估算按工作项填写，并列出影响估算的假设。将实现完成、验证通过、审校完成、合并和部署列为不同事项，计划中的检查不计为已执行。

## 填写示例
以下为虚构规划，不表示已实施或测试：草稿保存需求中，A 负责失败后保留编辑内容，B 负责重试状态流转；二者都可能涉及同一产品层。共同约定保存结果的成功与失败含义，由集成人负责共享状态文件。先补失败路径测试，再实现各自行为，最后验证“失败—编辑—重试成功”的完整流程。所有验证状态均为未运行。

## 完成检查
- [ ] 每项工作能追溯到需求，且有负责人和完成条件。
- [ ] A/B 边界、共享文件与接口变更通知方式清楚。
- [ ] 测试有入口、前置条件和预期结果，集成有人负责。
- [ ] 风险、阻塞项和发布前门槛没有被估算或假设掩盖。

## 文档衔接
向实现模块 A 和实现模块 B 交付各自边界、接口契约、基线和验证任务；向运行测试提供验收映射及集成顺序；向 Agent 代码审校提供风险重点。需求新增或边界变化应回到需求分析确认，再同步计划。`,
    en: `## Before you start
Turn accepted requirements into executable, verifiable work that can be integrated. Collect Requirements analysis, the full repository baseline SHA, development constraints, and existing test entry points. If a requirement or interface is unresolved, mark it pending, assign an owner, and state which work it blocks. Do not silently expand scope through the plan.

## Work breakdown and ownership
| Work item | Requirement IDs | Inputs and outputs | Owner | Completion condition |
| --- | --- | --- | --- | --- |
| Module A: [Enter] | [Enter IDs] | [Enter interface or patch] | [Enter] | [Enter verifiable outcome] |
| Module B: [Enter] | [Enter IDs] | [Enter interface or patch] | [Enter] | [Enter verifiable outcome] |
A and B are arbitrary labels for this task's partition. They may represent business capabilities, data processing, or other clear boundaries; they do not automatically mean frontend and backend. Specify owned and excluded files, behaviors, and shared areas. Name the person responsible for integrating changes to shared files.

## Interfaces and execution order
- Baseline and work location: [Enter full commit SHA, workspace, and branch]
- Interface contract: [Enter inputs, outputs, error semantics, version, and contract location]
- Dependencies: [Enter prerequisites, independent work, and handoff contents]
- Integration owner and order: [Enter patch order and shared-file conflict owner]
For interface changes, identify corresponding changes needed in the other module. Verify the contract before integrating behavior. Explain how to return to the preceding usable revision if integration fails while preserving others' uncommitted work.

## Verification plan
| Acceptance ID | Verification level | Entry point and prerequisites | Expected result | Planned executor |
| --- | --- | --- | --- | --- |
| [Enter REQ ID] | [Enter unit, integration, or manual acceptance] | [Enter existing project command or steps] | [Enter observable result] | [Enter] |
For behavioral changes, plan a test that exposes the original problem and a regression check after the change. Explain how it distinguishes correct from incorrect implementations. Plan module checks, A/B integration, and real user actions separately. A passing module check cannot stand in for the integrated result.

## Risks and delivery gates
- Risk and mitigation: [Enter trigger, impact, and response]
- Test data or environment gap: [Enter owner and resolution date]
- Review package: [Enter how the baseline, candidate revision, and review scope will be supplied]
- Delivery gates: [Enter required checks, acceptable residual risks, and decision owner]
Estimate each work item and name the assumptions behind its estimate. Track implementation, verification, review, merge, and deployment separately. Planned checks are not executed checks.

## Worked example
Fictional plan only; no implementation or test is claimed: for draft saving, A preserves editor content after a failure, and B handles retry state transitions. Both may affect the same product layer. They agree on the meanings of successful and failed save results, and an integration owner manages the shared state file. Add a failure-path test, implement each behavior, then verify the complete “failure—edit—successful retry” flow. All verification remains “Not run.”

## Completion checklist
- [ ] Every work item maps to requirements and has an owner and completion condition.
- [ ] A/B boundaries, shared files, and interface-change communication are explicit.
- [ ] Tests have entry points, prerequisites, and expected results; integration has an owner.
- [ ] Risks, blockers, and delivery gates remain visible alongside estimates and assumptions.

## Related documents
Give Implement module A and Implement module B their boundaries, contracts, baseline, and verification tasks. Pass acceptance mappings and integration order to Run tests, and risk priorities to Agent code review. Return new requirements or changed boundaries to Requirements analysis for confirmation before updating this plan.`,
  },
  'implement-module-a': {
    zh: `## 填写前
本页记录模块 A 的实现范围、接口协作与可复核证据。准备实施计划、相关需求、约定接口、仓库基线和分配的工作区。A 是任意工作分区，不预设技术层；按实际分工填写。缺少接口、权限或环境时列为阻塞，注明负责人，不编造实现结果。

## 责任边界与接口
- 负责的需求及行为：[填写编号、输入和输出]
- 负责文件与排除范围：[填写路径、共享文件及集成人]
- 与模块 B 的契约：[填写接口版本、参数、返回值和错误处理]
- 依赖输入：[填写由谁提供、何时可用、尚缺什么]
说明哪些行为由 A 独立保证，哪些只有与 B 集成后才能验收。若发现计划边界不成立，先记录调整原因及双方确认状态，再修改相关约定。

## 实现与决策记录
| 改动位置 | 原行为或问题 | 新行为与原因 | 对应需求 |
| --- | --- | --- | --- |
| [填写文件及符号] | [填写] | [填写方案和取舍] | [填写 REQ 编号] |
记录关键数据流、失败处理和兼容性选择，让接手者能解释为何这样实现。列出新增依赖或配置的目的、默认行为和使用条件；无此类变更也明确写“无”。不要仅复制提交标题。

## 修订与本地验证
- 仓库和工作区：[填写]；基础完整 SHA：[填写]
- 候选完整 SHA，或补丁文件路径与内容校验值：[填写]
- 未提交修改及证据覆盖范围：[填写，说明是否包含在补丁中]
| 检查项 | 环境与可复现步骤 | 预期结果 | 实际结果与状态 | 证据位置 |
| --- | --- | --- | --- | --- |
| [填写失败路径或需求] | [填写版本、数据和入口] | [填写] | 未运行：[填写原因] | [填写运行后记录位置] |
实际执行后再替换状态为通过、失败或阻塞，并记录时间。行为修复应保留原问题可复现证据和修复后结果；未运行不等于通过，A 的检查不能证明整体集成成功。

## 集成交接与已知限制
- 提供给 B 的产物与接口差异：[填写]
- 组合顺序与共享文件处理：[填写集成人、冲突点和解决依据]
- 尚未验证的组合场景：[填写]
- 已知限制与回退条件：[填写用户影响、责任人及可恢复修订]
交接后若候选修订再次变化，通知测试和审校人员，并标出哪些旧证据需要重跑或重审。

## 填写示例
以下为虚构示例，不代表真实改动或通过结果：A 被分配“保存失败后保留正文”，B 被分配“重试状态”。A 在记录中说明错误响应不得清空编辑缓存，并向 B 交付错误状态约定。候选 SHA 写为待生成；“失败时正文不变”的预期已填写，实际状态为未运行，原因是测试环境未就绪，因此不能写“模块已验证”。

## 完成检查
- [ ] A 的边界及与 B 的契约和共享文件责任已写清。
- [ ] 每项主要改动有原因、位置和需求编号。
- [ ] 提供完整 SHA 或可核验补丁，明确未提交修改范围。
- [ ] 验证区分预期与实际，限制和未运行场景已移交。

## 文档衔接
以实施计划为边界来源；向实现模块 B 交接接口差异与集成输入。向运行测试和 Agent 代码审校交付候选修订、改动表和证据；发现的问题在修复缺陷中按编号追踪，修复后更新此页的修订引用。`,
    en: `## Before you start
Record module A's implementation scope, interface coordination, and reviewable evidence. Collect Implementation plan, relevant requirements, agreed interfaces, the repository baseline, and assigned workspace. A is an arbitrary work partition, not a predetermined technical layer. Missing interfaces, permissions, or environments are blockers with owners; do not invent implementation results.

## Ownership and interfaces
- Owned requirements and behavior: [Enter IDs, inputs, and outputs]
- Owned files and exclusions: [Enter paths, shared files, and integration owner]
- Contract with module B: [Enter interface version, parameters, return values, and error handling]
- Required inputs: [Enter provider, availability, and missing items]
Explain which behavior A guarantees independently and which requires integration with B. If the planned boundary proves unsuitable, record the reason and both owners' confirmation status before updating the agreement.

## Implementation and decisions
| Change location | Previous behavior or problem | New behavior and rationale | Requirement |
| --- | --- | --- | --- |
| [Enter file and symbol] | [Enter] | [Enter approach and tradeoff] | [Enter REQ ID] |
Describe the important data flow, failure handling, and compatibility decisions so another person can explain the implementation. For new dependencies or configuration, record their purpose, default behavior, and usage conditions. Write “None” if there are no such changes. Commit titles alone are insufficient.

## Revision and local verification
- Repository and workspace: [Enter]; full base SHA: [Enter]
- Full candidate SHA, or patch path and content checksum: [Enter]
- Uncommitted changes and evidence coverage: [Enter whether these are included in the patch]
| Check | Environment and reproducible steps | Expected result | Actual result and status | Evidence location |
| --- | --- | --- | --- | --- |
| [Enter failure path or requirement] | [Enter versions, data, and entry point] | [Enter] | Not run: [Enter reason] | [Enter where the eventual run record belongs] |
Only after execution, replace the status with Passed, Failed, or Blocked and record the time. For a behavior fix, preserve evidence that reproduces the original problem and evidence after the fix. Not run does not mean Passed. A's local checks do not establish integration success.

## Integration handoff and limitations
- Artifacts and interface differences supplied to B: [Enter]
- Combination order and shared-file handling: [Enter owner, conflict points, and resolution basis]
- Combined scenarios not yet verified: [Enter]
- Known limitations and rollback conditions: [Enter user impact, owner, and recoverable revision]
If the candidate changes after handoff, notify the tester and reviewer and identify which evidence must be rerun or reviewed again.

## Worked example
Fictional example only; no actual change or passing result is claimed: A owns “preserve text after a failed save,” and B owns “retry state.” A records that an error response must not clear the editing buffer and supplies error-state semantics to B. The candidate SHA remains pending. The expected result for “text is unchanged after failure” is defined, but its actual status is Not run because the test environment is unavailable. The module therefore cannot be described as verified.

## Completion checklist
- [ ] A's boundary, contract with B, and shared-file ownership are clear.
- [ ] Each significant change has a location, rationale, and requirement ID.
- [ ] A full SHA or verifiable patch is supplied, with uncommitted changes identified.
- [ ] Verification separates expected and actual results; limitations and unrun scenarios are handed over.

## Related documents
Use Implementation plan as the source of scope. Give Implement module B the interface differences and integration inputs. Send the candidate revision, change table, and evidence to Run tests and Agent code review. Track findings by ID in Fix defects and update the revision reference on this page after fixes.`,
  },
  'implement-module-b': {
    zh: `## 填写前
本页记录模块 B 的实现及其与 A 的组合条件。准备实施计划、需求编号、双方接口约定、基础完整 SHA 和分配工作区。B 只是任务分区标签，可与 A 处于同一技术层，不默认承担界面或某一种职责。输入缺失时写待确认或阻塞、负责人及影响，不把临时模拟当成真实依赖已就绪。

## 分工与依赖确认
- B 负责的用户行为及需求：[填写]
- 负责文件、排除范围与共享区域：[填写]
- 从 A 接收和向 A 提供的输入：[填写结构、版本及错误语义]
- 接口差异或尚未达成的约定：[填写确认人和解决时间]
核对 B 的前置条件是否与 A 的实际产物一致；使用模拟数据时写清替代了什么、未验证什么。共享逻辑由哪一方修改、谁最后整合都要明确。

## 改动与设计取舍
| 位置 | 负责的行为 | 实现方式及原因 | 兼容性影响 |
| --- | --- | --- | --- |
| [填写文件及符号] | [填写 REQ 编号和行为] | [填写方案与备选取舍] | [填写旧数据或调用方影响] |
说明状态如何流转、失败时如何反馈，以及重复操作或异常输入的处理。新增配置或依赖应写用途和默认值；未采用备选方案时记录关键原因，让审校者能够判断取舍。

## 可定位产物与验证
- 仓库、工作区与基础完整 SHA：[填写]
- B 候选完整 SHA，或补丁路径与内容校验值：[填写]
- 所配合的 A 修订及未提交修改：[填写具体范围]
| 场景 | 环境、输入与重现步骤 | 预期结果 | 实际结果与状态 | 证据位置 |
| --- | --- | --- | --- | --- |
| [填写正常或异常场景] | [填写版本及入口] | [填写可观察结果] | 未运行：[填写原因] | [填写运行记录位置] |
执行后记录时间与真实观察，区分通过、失败、阻塞和未运行。保留能够暴露原问题的证据及修复后回归结果；只有模拟接口下的成功，不足以证明与 A 的实际产物兼容。

## 组合验收与限制
- 集成负责人及组合顺序：[填写]
- 需要双方一起验证的场景：[填写输入跨边界后的完整结果]
- 冲突位置、处理依据与待同步内容：[填写]
- 尚未验证行为及回退条件：[填写用户影响、负责人和可恢复修订]
接口或候选修订变化后，更新对 A 的依赖引用，通知测试和审校人员确认旧证据是否仍适用。

## 填写示例
以下为虚构示例，并非实际提交或测试：B 负责保存重试状态，A 负责失败后保留正文。B 的实现记录应写清“再次点击重试时使用当前正文”，避免使用失败请求的旧副本。使用模拟保存结果完成的检查只能标为模拟环境结果；与 A 组合的实际结果仍为未运行。双方完整 SHA 未取得前，修订栏保持待补。

## 完成检查
- [ ] B 的职责和双向接口明确，模拟依赖已标注。
- [ ] 改动表覆盖异常输入、兼容性和关键取舍。
- [ ] B 产物及配合的 A 修订均可定位，未提交改动范围清楚。
- [ ] 实际验证和待集成场景分开记录，共享文件有人整合。

## 文档衔接
从实施计划获取分工与契约，与实现模块 A 同步实际接口和修订。向运行测试提供可复现步骤、模拟环境限制和组合场景，向 Agent 代码审校提供改动依据及候选产物；遗留问题交给修复缺陷追踪。`,
    en: `## Before you start
Record module B's implementation and the conditions for combining it with A. Collect Implementation plan, requirement IDs, agreed interfaces, the full base SHA, and assigned workspace. B is a task partition and may occupy the same technical layer as A; it is not automatically responsible for a user interface or any particular layer. Mark missing inputs as Pending or Blocked, with an owner and impact. A temporary mock does not establish that the real dependency is ready.

## Responsibilities and dependencies
- User behavior and requirements owned by B: [Enter]
- Owned files, exclusions, and shared areas: [Enter]
- Inputs received from and provided to A: [Enter structures, versions, and error semantics]
- Interface differences or unresolved agreements: [Enter decision owner and resolution date]
Check whether B's preconditions match A's actual output. For mocked data, explain what it substitutes and what remains unverified. Name the owner of shared-logic changes and the person who performs final integration.

## Changes and design decisions
| Location | Owned behavior | Implementation and rationale | Compatibility impact |
| --- | --- | --- | --- |
| [Enter file and symbol] | [Enter REQ ID and behavior] | [Enter approach and alternatives] | [Enter impact on old data or callers] |
Explain state transitions, failure feedback, and the handling of repeated actions or invalid input. Describe the purpose and defaults of new configuration or dependencies. Record the decisive reason for rejecting alternatives so a reviewer can assess the tradeoff.

## Identifiable artifacts and verification
- Repository, workspace, and full base SHA: [Enter]
- Full B candidate SHA, or patch path and content checksum: [Enter]
- Associated A revision and uncommitted changes: [Enter exact scope]
| Scenario | Environment, input, and reproduction steps | Expected result | Actual result and status | Evidence location |
| --- | --- | --- | --- | --- |
| [Enter normal or failure scenario] | [Enter versions and entry point] | [Enter observable outcome] | Not run: [Enter reason] | [Enter run record location] |
After execution, record the time and actual observation. Distinguish Passed, Failed, Blocked, and Not run. Preserve evidence that exposes the original problem and the regression result after the fix. Success against a mock interface does not establish compatibility with A's real artifact.

## Combined acceptance and limitations
- Integration owner and combination order: [Enter]
- Scenarios that require both modules: [Enter the complete result across the boundary]
- Conflict locations, resolution rationale, and synchronization needs: [Enter]
- Unverified behavior and rollback conditions: [Enter user impact, owner, and recoverable revision]
When an interface or candidate revision changes, update the dependency reference to A and notify the tester and reviewer so they can reassess earlier evidence.

## Worked example
Fictional example only; this is not an actual commit or test: B owns save-retry state and A owns preservation of text after failure. B records that retry must use the current text, not a stale copy from the failed request. A check using a mocked save result can only be reported as a mock-environment result. Integration with A remains Not run. Until both full SHAs are available, the revision fields remain pending.

## Completion checklist
- [ ] B's responsibilities and two-way interfaces are clear, and mocked dependencies are labeled.
- [ ] The change table covers invalid input, compatibility, and important tradeoffs.
- [ ] B's artifact and its associated A revision are identifiable; uncommitted changes are described.
- [ ] Actual verification is separate from pending integration, and shared files have an integration owner.

## Related documents
Take boundaries and contracts from Implementation plan and synchronize actual interfaces and revisions with Implement module A. Supply Run tests with reproducible steps, mock-environment limitations, and combined scenarios. Give Agent code review the candidate artifact and rationale. Track remaining findings in Fix defects.`,
  },
  'run-tests': {
    zh: `## 填写前
本页提供别人能够重跑的测试证据，回答哪些需求在什么修订和环境上得到验证。准备需求分析、实施计划、A/B 两份候选产物及集成说明。缺少产物、数据或环境时标记阻塞或未运行，写清原因与负责人；未运行绝不写成通过。

## 被测对象与环境
- 仓库及基础完整 SHA：[填写]
- A/B 完整候选 SHA 或补丁路径与校验值：[填写]
- 组合后的完整 SHA 或组合补丁校验值：[填写]
- 工作区未提交修改：[填写是否纳入被测对象]
- 系统、运行时、依赖版本及配置差异：[填写，不粘贴密钥]
- 数据准备与清理办法：[填写固定样本、账号角色和隔离方式]
记录集成顺序和测试开始时间。分支名会移动，不能作为唯一版本证据；截图需要附带操作与修订信息。

## 用例与覆盖映射
| 用例编号 | 需求编号与层次 | 前置条件及输入 | 可复现步骤或已有测试入口 | 预期结果 |
| --- | --- | --- | --- | --- |
| TC-01 | [填写 REQ 编号、单元或集成等] | [填写角色和数据] | [填写顺序与参数] | [填写状态、内容或错误] |
覆盖模块 A、模块 B、接口组合及适用的真实用户路径。正常、失败、权限和边界场景分行记录；不适用时写理由。将手工步骤写到其他人无需询问即可执行。

## 执行结果与证据
| 用例编号 | 执行时间与执行人 | 实际观察 | 状态 | 日志、截图或报告位置 |
| --- | --- | --- | --- | --- |
| TC-01 | [填写] | [填写执行后的真实输出；未执行则写无] | 未运行 | [填写证据位置] |
状态仅在真实执行后更新为通过、失败或阻塞；通过要求实际结果满足预期。记录命令退出状态、断言结果或手工观察，不能把启动成功当作断言通过。汇总总数、通过、失败、阻塞和未运行，确保合计一致。

## 失败分流与复测范围
- 失败编号及关联用例：[填写]；稳定复现条件：[填写]
- 分类：[填写产品缺陷、环境问题或待定位及依据]
- 建议严重程度和用户影响：[填写，说明理由]
- 修复后必跑用例与相关回归：[填写]
保留首次失败证据，重跑另记修订、时间和结果，不覆盖历史失败。偶发通过需记录重复次数与失败比例；有未覆盖范围时结论只能覆盖实际执行部分。

## 填写示例
以下为虚构记录样式，不是实际测试结果：TC-01 预期“保存失败后正文保留并出现重试入口”；TC-02 预期“修改正文后重试保存最新内容”。当前缺少集成候选 SHA，两个用例都标为未运行，实际观察为无、证据待补，汇总为总计 2、未运行 2。即使单模块报告通过，也不能据此填写两个集成用例通过。

## 完成检查
- [ ] 被测 A/B 产物和组合修订均可准确定位。
- [ ] 每个用例有环境、步骤、预期和独立的实际结果。
- [ ] 数量与状态一致，未运行和阻塞未计为通过。
- [ ] 失败可追踪，复测保留旧证据并覆盖关联回归。

## 文档衔接
从实现模块 A 和实现模块 B 获取产物，按实施计划覆盖需求分析的验收条件。向修复缺陷交付失败编号、复现步骤和证据；向 Agent 代码审校共享覆盖缺口；向发布摘要传递修订明确的结果、未执行项和限制。`,
    en: `## Before you start
Provide reproducible evidence of which requirements were verified, on which revision, and in which environment. Collect Requirements analysis, Implementation plan, both A/B candidate artifacts, and integration instructions. Missing artifacts, data, or environments mean Blocked or Not run, with a reason and owner. Never report an unexecuted test as passed.

## Test subject and environment
- Repository and full base SHA: [Enter]
- Full A/B candidate SHAs, or patch paths and checksums: [Enter]
- Full combined SHA, or combined patch checksum: [Enter]
- Uncommitted workspace changes: [Enter whether they form part of the test subject]
- Operating system, runtime, dependency versions, and configuration differences: [Enter without secrets]
- Data preparation and cleanup: [Enter fixed samples, account roles, and isolation]
Record integration order and test start time. A moving branch name is insufficient as the only revision reference. Screenshots need accompanying actions and revision details.

## Cases and coverage mapping
| Case ID | Requirement ID and level | Preconditions and input | Reproducible steps or existing test entry point | Expected result |
| --- | --- | --- | --- | --- |
| TC-01 | [Enter REQ ID and unit, integration, or other level] | [Enter role and data] | [Enter sequence and arguments] | [Enter state, content, or error] |
Cover A, B, their combined interfaces, and applicable real user flows. Record normal, failure, permission, and boundary scenarios separately; explain exclusions. Manual steps must be sufficient for another person to execute without additional explanation.

## Execution results and evidence
| Case ID | Execution time and executor | Actual observation | Status | Log, screenshot, or report location |
| --- | --- | --- | --- | --- |
| TC-01 | [Enter] | [Enter real output after execution; otherwise None] | Not run | [Enter evidence location] |
Update to Passed, Failed, or Blocked only after actual execution. Passed requires the observed result to meet the expectation. Record exit status, assertion outcomes, or manual observations. Successful startup does not establish passing assertions. Summarize total, passed, failed, blocked, and not-run counts and reconcile the totals.

## Failure triage and retest scope
- Failure ID and related cases: [Enter]; reliable reproduction conditions: [Enter]
- Classification: [Enter product defect, environment issue, or unresolved, with rationale]
- Suggested severity and user impact: [Enter with reasoning]
- Required post-fix cases and related regressions: [Enter]
Preserve the original failure evidence. Add new revision, time, and result records for reruns rather than replacing failures. For intermittent success, report attempts and failure frequency. Conclusions must be limited to the coverage actually executed.

## Worked example
Fictional record format, not an actual test result: TC-01 expects “text remains after a failed save and a retry action appears.” TC-02 expects “retry after an edit saves the latest text.” The integrated candidate SHA is missing, so both cases are Not run, actual observation is None, and evidence is pending. The summary is 2 total and 2 not run. A passing module report would not establish that either integration case passed.

## Completion checklist
- [ ] Both A/B artifacts and the combined tested revision are precisely identifiable.
- [ ] Each case has an environment, steps, expectations, and separate actual results.
- [ ] Counts and statuses reconcile; blocked and unrun cases are not counted as passed.
- [ ] Failures are traceable, with original evidence preserved and related regressions retested.

## Related documents
Obtain artifacts from Implement module A and Implement module B. Follow Implementation plan to cover the acceptance criteria in Requirements analysis. Give Fix defects failure IDs, reproduction steps, and evidence. Share coverage gaps with Agent code review. Pass revision-specific outcomes, unrun items, and limitations to Release summary.`,
  },
  'agent-code-review': {
    zh: `## 填写前
本页记录可核验的代码审校结论，人工审校者也可直接使用。准备需求分析、实施计划、A/B 候选补丁及运行测试证据。缺少源码、修订或运行权限时写明无法检查的范围，不以“看起来正常”替代证据，也不将静态阅读等同测试通过。

## 审校对象与方法
- 仓库、基础完整 SHA 与候选完整 SHA：[填写；补丁则写路径及校验值]
- A/B 组合关系与未提交修改：[填写是否在本次范围内]
- 审校者、日期与检查方式：[填写阅读、追踪调用或实际复现]
- 已读范围与未覆盖范围：[填写路径、接口及原因]
确保差异对应当前候选产物。候选改变后注明需重审的部分，旧报告不可自动覆盖新代码。

## 正确性与集成检查
| 检查主题 | 要回答的问题 | 检查位置及证据 | 结论或缺口 |
| --- | --- | --- | --- |
| 需求符合性 | [填写哪个 REQ 的行为是否实现] | [填写路径、符号或用例] | [填写] |
| A/B 契约 | [填写输入输出和错误处理是否一致] | [填写] | [填写] |
| 失败与兼容 | [填写异常、重复操作、旧数据如何处理] | [填写] | [填写] |
追踪具体输入如何到达改动位置、状态怎样变化，以及调用方依赖是否成立。涉及权限边界、外部输入或日志时检查访问控制、校验和敏感数据处理；不适用的项写理由。

## 发现记录与严重程度
| 发现编号 | 严重程度与理由 | 触发条件和实际影响 | 位置及证据 | 建议修复与验证 |
| --- | --- | --- | --- | --- |
| REV-01 | [填写等级及用户影响] | [填写最小复现或可追踪路径] | [填写候选修订上的文件、行或符号] | [填写目标行为和回归方式] |
使用项目既有等级；若没有，明确约定：阻断为数据损坏或关键流程不可用，高为重要功能错误，中为受限场景问题，低为轻微问题。把待验证疑点、已证实缺陷和可选建议分开，避免把偏好写成必修缺陷。

## 结论与复审条件
- 结论：[填写可接受、需修复后复审或证据不足]
- 阻断发现：[填写编号；无则明确写无]
- 未解决疑点及责任人：[填写]
- 复审范围：[填写需检查的修订、用例及接口影响]
无发现只能说明本次范围未发现问题。引用运行测试时写明其被测修订；测试通过不能代替代码审校，审校可接受也不表示已合并或部署。

## 填写示例
以下为虚构审校示例，不是实际发现：REV-01 描述“用户在失败后继续编辑，重试仍发送旧正文”，建议高严重程度，理由是可能覆盖用户最新输入。证据栏应补候选修订上的状态读取位置，验证建议为失败后修改正文再重试。当前尚无源码和复现材料，因此应标为待验证疑点，不能宣称已确认缺陷。

## 完成检查
- [ ] 审校范围与完整修订可定位，未覆盖部分已列出。
- [ ] 发现包含触发条件、具体影响、位置和证据。
- [ ] 严重程度有理由，疑点与可选建议没有混入已证实缺陷。
- [ ] 结论写清阻断项及复审条件，没有扩大为发布成功。

## 文档衔接
对照需求分析和实施计划，读取实现模块 A 与实现模块 B 的产物。向修复缺陷交付稳定发现编号及验证建议；与运行测试对齐证据和覆盖缺口。向发布摘要提供最终审校修订、结论与残余风险。`,
    en: `## Before you start
Record evidence-based code review findings; a human reviewer can use this page directly. Collect Requirements analysis, Implementation plan, A/B candidate patches, and Run tests evidence. If source, revisions, or execution access are unavailable, state the uncheckable scope. “Looks fine” is not evidence, and static inspection is not a passing test.

## Review subject and method
- Repository, full base SHA, and full candidate SHA: [Enter; for a patch, supply path and checksum]
- A/B combination and uncommitted changes: [Enter whether they are in scope]
- Reviewer, date, and method: [Enter reading, call tracing, or actual reproduction]
- Inspected and uninspected scope: [Enter paths, interfaces, and reasons]
Ensure the diff corresponds to the current candidate. If the candidate changes, identify the areas requiring review again. An old report does not automatically cover new code.

## Correctness and integration checks
| Topic | Question to answer | Location and evidence | Conclusion or gap |
| --- | --- | --- | --- |
| Requirements | [Enter whether a specific REQ behavior is implemented] | [Enter path, symbol, or case] | [Enter] |
| A/B contract | [Enter whether inputs, outputs, and error handling agree] | [Enter] | [Enter] |
| Failure and compatibility | [Enter behavior for exceptions, repeated actions, and old data] | [Enter] | [Enter] |
Trace how a concrete input reaches the change, how state changes, and whether caller assumptions hold. For permission boundaries, external inputs, or logs, inspect access control, validation, and sensitive-data handling. Explain checks that are not applicable.

## Findings and severity
| Finding ID | Severity and rationale | Trigger and actual impact | Location and evidence | Proposed fix and verification |
| --- | --- | --- | --- | --- |
| REV-01 | [Enter level and user impact] | [Enter minimal reproduction or traceable path] | [Enter file, line, or symbol on the candidate revision] | [Enter target behavior and regression method] |
Use the project's severity scheme. If none exists, define one explicitly: Blocker for data corruption or an unusable critical flow, High for a significant functional error, Medium for a limited scenario, and Low for a minor issue. Separate unverified concerns, confirmed defects, and optional suggestions. Personal preference alone does not make a mandatory defect.

## Verdict and rereview conditions
- Verdict: [Enter Acceptable, Fix and rereview, or Insufficient evidence]
- Blocking findings: [Enter IDs or explicitly None]
- Unresolved concerns and owners: [Enter]
- Rereview scope: [Enter revisions, cases, and interface impacts to inspect]
No findings means only that none were found within this review's scope. When citing Run tests, identify the tested revision. Passing tests do not replace review; an acceptable review does not establish merge or deployment.

## Worked example
Fictional review example, not an actual finding: REV-01 describes “after a failed save and another edit, retry sends the old text.” High severity is proposed because the latest input could be overwritten. Evidence must identify where state is read on the candidate revision; verification should edit after failure and then retry. With no source or reproduction evidence yet, this remains an unverified concern, not a confirmed defect.

## Completion checklist
- [ ] Review scope and full revisions are identifiable, with unchecked areas listed.
- [ ] Findings state triggers, specific impacts, locations, and evidence.
- [ ] Severity is justified; concerns and optional suggestions are separate from confirmed defects.
- [ ] The verdict identifies blockers and rereview conditions without claiming release success.

## Related documents
Compare the artifacts from Implement module A and Implement module B with Requirements analysis and Implementation plan. Pass stable finding IDs and verification suggestions to Fix defects. Coordinate evidence and coverage gaps with Run tests. Supply Release summary with the final reviewed revision, verdict, and residual risks.`,
  },
  'fix-defects': {
    zh: `## 填写前
本页把测试失败和审校发现追踪到修复与回归证据。准备运行测试、Agent 代码审校、当前候选修订及模块交接说明。缺少复现条件时先标记待定位，指定补充材料的人；暂时无法重现不等于已修复。保留原始失败和审校记录。

## 缺陷清单与分流
| 缺陷编号 | 来源编号 | 严重程度与影响 | 负责人 | 处置状态 |
| --- | --- | --- | --- | --- |
| BUG-01 | [填写 TC 或 REV 编号] | [填写等级、受影响用户和理由] | [填写] | 待定位 |
沿用项目严重程度；没有约定时明确阻断、高、中、低各代表什么影响。重复发现可合并，但保留所有来源编号。把产品缺陷、环境阻塞和可选建议分开；不修复的项需有具体依据、风险和决定人，不能无声关闭。

## 复现与根因
- 受影响完整 SHA 或补丁校验值：[填写]
- 环境、数据和最小步骤：[填写]
- 预期行为与实际错误：[分别填写]
- 原始证据位置：[填写日志、报告或截图及时间]
- 根因和定位依据：[填写导致问题的条件、路径或状态；尚未知则写待定位]
解释为何该根因会产生观察到的症状，区分事实和推测。修改前确认测试确实能暴露同一问题，避免用无关失败作为修复依据。

## 修复方案与产物
| 缺陷编号 | 修复位置及行为变化 | 影响范围与兼容性 | 修复产物 |
| --- | --- | --- | --- |
| BUG-01 | [填写文件、符号及方案] | [填写相关调用方、数据和 A/B 接口] | [填写完整 SHA 或补丁路径与校验值] |
记录基础修订、最终候选和未提交修改范围。说明为何修复解决根因，以及未选择其他办法的关键理由。跨 A/B 边界时通知双方更新接口和组合顺序。

## 复测与关闭依据
| 缺陷编号与用例 | 被测修订、环境和步骤 | 预期结果 | 实际结果与状态 | 回归证据 |
| --- | --- | --- | --- | --- |
| BUG-01 / [填写 TC 编号] | [填写] | [填写] | 未运行：[填写原因] | [填写] |
同时验证原失败路径和受影响的相邻行为。重跑保留每次时间与结果，不能覆盖原失败。关闭条件写清修复产物存在、针对性复测符合预期、所需回归和复审已完成；仅代码已改则标为待验证。若接受残余风险，单列确认人、理由和适用期限。

## 填写示例
以下为虚构流程示例，不代表已发现或已修复的问题：BUG-01 关联 REV-01，描述重试使用旧正文。假设根因为重试读取过期快照，拟改为读取当前内容，并增加“失败后编辑再重试”的回归用例。由于候选 SHA 和执行结果尚未取得，状态只能是待验证或待实施，不能填写关闭；根因也应保持待验证标记。

## 完成检查
- [ ] 每项发现都能追溯来源，严重程度和处置理由明确。
- [ ] 原始失败证据保留，根因有依据或明确标记未确认。
- [ ] 修复产物可定位，原场景和相关回归分别记录实际结果。
- [ ] 关闭项满足约定条件，剩余风险和阻塞没有被遗漏。

## 文档衔接
接收运行测试和 Agent 代码审校的发现；涉及实现边界时同步实现模块 A、实现模块 B。修复后把最终候选交回运行测试与 Agent 代码审校复核，再向发布摘要交付缺陷处置表、验证证据和未解决项。`,
    en: `## Before you start
Trace test failures and review findings through repair and regression evidence. Collect Run tests, Agent code review, the current candidate revision, and module handoff notes. Missing reproduction details mean Investigation pending, with an owner for the missing material. Failure to reproduce temporarily does not mean Fixed. Preserve original failures and review records.

## Defect register and triage
| Defect ID | Source IDs | Severity and impact | Owner | Disposition status |
| --- | --- | --- | --- | --- |
| BUG-01 | [Enter TC or REV IDs] | [Enter level, affected users, and rationale] | [Enter] | Investigation pending |
Use the project severity scheme. If none exists, define the impacts represented by Blocker, High, Medium, and Low. Duplicate findings may be combined while retaining every source ID. Separate product defects, environment blockers, and optional suggestions. A decision not to fix needs specific reasoning, risk, and a decision owner; do not silently close the item.

## Reproduction and root cause
- Affected full SHA or patch checksum: [Enter]
- Environment, data, and minimal steps: [Enter]
- Expected behavior and actual error: [Enter separately]
- Original evidence location: [Enter log, report, or screenshot and time]
- Root cause and supporting evidence: [Enter causal condition, path, or state; otherwise Investigation pending]
Explain why the proposed cause produces the observed symptom, distinguishing facts from hypotheses. Before changing code, ensure the test exposes the same problem rather than an unrelated failure.

## Fix and artifact
| Defect ID | Fix location and behavior change | Impact and compatibility | Fix artifact |
| --- | --- | --- | --- |
| BUG-01 | [Enter file, symbol, and approach] | [Enter callers, data, and A/B interfaces] | [Enter full SHA or patch path and checksum] |
Record the base revision, final candidate, and scope of uncommitted changes. Explain why the change addresses the cause and the decisive reason for rejecting alternatives. Notify both module owners when the fix crosses their boundary so interfaces and integration order remain aligned.

## Retest and closure evidence
| Defect and case IDs | Tested revision, environment, and steps | Expected result | Actual result and status | Regression evidence |
| --- | --- | --- | --- | --- |
| BUG-01 / [Enter TC ID] | [Enter] | [Enter] | Not run: [Enter reason] | [Enter] |
Verify both the original failure path and affected neighboring behavior. Retain the time and outcome of each rerun without overwriting the original failure. Define closure as an identifiable fix, a successful focused retest, and completion of required regression checks and rereview. A code change alone is Awaiting verification. Separately record accepted residual risks with their decision owner, rationale, and time limit.

## Worked example
Fictional workflow example; no actual defect or fix is claimed: BUG-01 references REV-01 and describes retry using old text. A stale snapshot is the proposed cause. The planned fix reads current content and adds a “fail, edit, retry” regression case. Without a candidate SHA and execution results, the item can only be Planned or Awaiting verification, never Closed. The proposed cause must also remain labeled unverified.

## Completion checklist
- [ ] Every finding has source references, justified severity, and an explicit disposition.
- [ ] Original failure evidence is preserved; the cause is supported or marked unconfirmed.
- [ ] Fix artifacts are identifiable, with separate actual results for the original case and regressions.
- [ ] Closed items meet agreed conditions; remaining risks and blockers are visible.

## Related documents
Receive findings from Run tests and Agent code review. Coordinate boundary changes with Implement module A and Implement module B. Return the final candidate to Run tests and Agent code review for verification, then give Release summary the disposition table, evidence, and unresolved items.`,
  },
  'release-summary': {
    zh: `## 填写前
本页汇总合并或发布决策材料，本身不执行这些操作。准备需求、最终候选、测试和审校报告、缺陷处置及环境信息。证据缺失写待补及负责人；合并、部署和验收按真实状态记录，不从“实现完成”推断线上可用。

## 用户可见变化
- 发布名称、版本或候选标识：[填写]
- 目标用户与变化：[填写操作前后的具体行为]
- 对应需求与本次范围：[填写 REQ 编号及包含内容]
- 已知限制或不包含事项：[填写]
用使用者能理解的语言解释收益，另列必要的兼容性、配置或数据变化。涉及迁移时说明前置条件、影响和负责执行的人；没有迁移也明确写无。

## 候选修订与证据索引
| 材料 | 精确引用 | 覆盖范围与状态 | 负责人 |
| --- | --- | --- | --- |
| 最终候选 | [填写仓库、完整 SHA 或补丁路径与校验值] | [填写未提交修改是否包含] | [填写] |
| 测试证据 | [填写报告位置与被测完整修订] | [填写通过、失败、阻塞、未运行数量] | [填写] |
| 审校与缺陷 | [填写报告位置及审校修订] | [填写结论和未关闭编号] | [填写] |
确认测试、审校与最终候选一致；不一致时列出差异及补验范围。提供可访问的证据位置。

## 分阶段状态与决定
| 阶段 | 实际状态 | 证据或缺失原因 | 确认人及时间 |
| --- | --- | --- | --- |
| 需求与设计确认 | 待确认 | [填写] | [填写] |
| 实现完成 | 待核验 | [填写候选产物] | [填写] |
| 测试与审校 | 待核验 | [填写对应修订及结论] | [填写] |
| 合并 | 未确认 | [填写合并提交或尚未合并] | [填写] |
| 发布与部署 | 未确认 | [分别填写版本发布、各目标环境和实际部署状态] | [填写] |
| 实际客户端验收 | 未确认 | [填写目标客户端、操作及结果] | [填写] |
每个阶段独立填写，健康检查、版本标签或截图不能互相替代。明确本次请求人决定的是接受材料、允许合并还是允许发布，以及尚未满足的前提。

## 残余风险与恢复安排
- 未解决项：[填写编号、严重程度、用户影响及负责人]
- 继续发布或暂缓的依据：[填写证据与决定人]
- 恢复方案：[填写已知可用版本、触发条件、执行人及数据兼容限制]
- 后续观察：[填写目标信号、观察时段和异常处理人]
恢复方案未演练需如实标注；不要把计划中的回退能力写成已验证。风险接受应注明适用范围和后续处理时间。

## 填写示例
以下为虚构摘要，不是实际发布记录：候选改善草稿保存失败后的保留与重试行为。即使实现报告已齐全，若最终修订的集成测试尚未运行，应写“测试待完成，合并未确认，部署未确认，客户端验收未确认”。本次可请求审阅材料，不能宣布版本已上线；完整候选 SHA 和真实证据应由负责人补齐。

## 完成检查
- [ ] 用户变化可追溯到需求，最终候选可准确定位。
- [ ] 测试与审校证据对应最终修订，缺口和未解决项明确。
- [ ] 设计、实现、测试、合并、发布部署与客户端验收分别记录。
- [ ] 决策范围、风险负责人和恢复安排足以供人审阅。

## 文档衔接
从修复缺陷取得最终产物和处置表，向运行测试及 Agent 代码审校核对修订一致性；用需求分析确认范围。将本页连同证据提交给负责合并发布的人，决定后回填真实结果；新增缺陷返回修复缺陷，不把未验证事项写成已交付。`,
    en: `## Before you start
Assemble the material a person needs to decide on merge or release. This page does not itself merge, publish, or deploy anything. Collect the accepted scope, final candidate artifact, test and review reports, defect dispositions, and target-environment details. Mark missing evidence as Pending with an owner. Record unmerged, undeployed, and unaccepted states honestly; completed implementation does not imply production availability.

## User-visible changes
- Release name, version, or candidate identifier: [Enter]
- Target users and change: [Enter concrete before-and-after behavior]
- Requirements and release scope: [Enter REQ IDs and included work]
- Known limitations or exclusions: [Enter]
Explain the benefit in language users understand. Separately identify necessary compatibility, configuration, or data changes. If migration is required, state prerequisites, impact, and executor. Explicitly write None when no migration is needed.

## Candidate revision and evidence index
| Material | Exact reference | Coverage and status | Owner |
| --- | --- | --- | --- |
| Final candidate | [Enter repository, full SHA, or patch path and checksum] | [Enter whether uncommitted changes are included] | [Enter] |
| Test evidence | [Enter report location and full tested revision] | [Enter passed, failed, blocked, and not-run counts] | [Enter] |
| Review and defects | [Enter report locations and reviewed revision] | [Enter verdict and open IDs] | [Enter] |
Check whether the tested, reviewed, and final revisions match. If they differ, describe the changes and additional verification needed. Supply accessible evidence locations rather than only saying “Checked.”

## Stage status and decision
| Stage | Actual status | Evidence or reason it is missing | Decision owner and time |
| --- | --- | --- | --- |
| Requirements and design acceptance | Pending confirmation | [Enter] | [Enter] |
| Implementation complete | Awaiting verification | [Enter candidate artifact] | [Enter] |
| Tests and review | Awaiting verification | [Enter revisions and conclusions] | [Enter] |
| Merge | Unconfirmed | [Enter merge commit or Not merged] | [Enter] |
| Release and deployment | Unconfirmed | [Separately enter version publication, each target environment, and actual deployment state] | [Enter] |
| Real client acceptance | Unconfirmed | [Enter target client, action, and outcome] | [Enter] |
Record each stage independently. A health check, version tag, or screenshot cannot substitute for the other stages. State whether the current decision concerns accepting the package, allowing merge, or allowing release, together with unmet prerequisites.

## Residual risk and recovery
- Open items: [Enter IDs, severity, user impact, and owners]
- Basis for proceeding or holding: [Enter evidence and decision owner]
- Recovery plan: [Enter known usable version, trigger, executor, and data-compatibility limits]
- Follow-up observation: [Enter signals, observation window, and incident owner]
Label an unrehearsed recovery plan accordingly. Planned rollback capability is not verified capability. Risk acceptance needs a scope and follow-up date.

## Worked example
Fictional summary, not an actual release record: a candidate improves text preservation and retry after a failed draft save. Even if implementation reports are complete, integration tests on the final revision may still be Not run. The summary must then state “Testing pending; merge unconfirmed; deployment unconfirmed; client acceptance unconfirmed.” The package can be submitted for review, but the version cannot be announced as live. The owner must supply the full candidate SHA and actual evidence.

## Completion checklist
- [ ] User-visible changes trace to requirements and the final candidate is precisely identifiable.
- [ ] Test and review evidence covers the final revision, with gaps and open findings explicit.
- [ ] Design, implementation, tests, merge, release/deployment, and client acceptance are recorded separately.
- [ ] Decision scope, risk owners, and recovery arrangements are sufficient for human review.

## Related documents
Obtain the final artifact and disposition table from Fix defects. Confirm revision alignment with Run tests and Agent code review, and scope with Requirements analysis. Submit this page and its evidence to the person responsible for merge and release, then record actual decisions and outcomes. Return new defects to Fix defects; do not describe unverified work as delivered.`,
  },
};
