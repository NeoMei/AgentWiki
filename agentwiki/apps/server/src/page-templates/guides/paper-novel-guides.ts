export const paperNovelGuides: Record<string, { zh: string; en: string }> = {
  'research-scope': {
    zh: `## 填写前
本页把宽泛选题变成能用现有时间和材料回答的研究问题。先准备课程或投稿要求、已有资料目录、可用数据说明和截止时间。没有这些资料时，先写暂定范围与待确认项，不把研究设想写成已经得到的发现。先完成一句话问题，再补边界。

## 研究问题与意义
用“在什么对象和情境中，考察什么现象或关系”写主问题：[填写]。读者是谁，他们为什么需要这个答案？已有解释留下什么具体疑问？分别写研究动机、拟检验的判断和可能贡献，避免用“填补空白”替代可检查的问题。为每个子问题说明怎样的证据才足以回答。

## 范围与排除项
| 维度 | 纳入范围 | 不纳入及原因 | 待确认事项 |
| --- | --- | --- | --- |
| 对象、地区与时期 | [填写] | [填写] | [填写] |
| 核心概念与定义 | [填写] | [填写] | [填写] |
| 数据或文献类型 | [填写] | [填写] | [填写] |
说明相邻主题为什么暂不讨论；若需要扩大范围，记录对时间、材料和方法的影响。

## 证据与可行性
列出每个问题需要的文献、数据或原始记录，标明已取得、可申请、未找到。来源写到实际文件、数据库记录或可访问地址，并记录版本。说明访问条件、样本限制、分析能力和可用时间；存在参与者或敏感资料时，写明适用的审核与使用条件是否已经落实。无法取得关键材料时，选择缩小问题或明确暂缓判断。

## 判断标准与工作安排
写出成果形式、篇幅、引用格式和完成日期：[填写]。区分最低可交付结论与可选扩展；说明什么发现会推翻原来的预期，以及证据不足时如何报告。按资料收集、方法确认、初稿、核验分配时间，每阶段填负责人、产物与决定是否继续的条件。

## 填写示例
以下为虚构研究计划，不代表实际研究结果或已存在的文献：“考察某校两个班级在四周课程中如何使用阅读笔记。”暂纳入自愿提供的笔记与访谈，不比较成绩，不推断其他学校。若无法取得访谈许可，则只讨论获准使用的匿名笔记。预期成果是使用方式的分类；分类数量和效果须等待资料分析，不能提前填写。

## 完成检查
- [ ] 主问题限定了对象、情境和可观察内容，子问题能找到对应证据。
- [ ] 纳入、排除、材料可得性及使用条件分别写明。
- [ ] 假设、计划和实际发现有清楚区别，没有预先承诺研究结果。
- [ ] 时间、成果要求与证据不足时的处理方法可执行。

## 文档衔接
把研究问题、术语边界和纳入标准交给“文献综述”；把证据需求、可用材料与限制交给“方法分析”。范围有变更时，记录日期与理由，并同步到“章节起草”，避免正文继续回答旧问题。`,
    en: `## Before you start
Use this page to turn a broad topic into a question that your available evidence and time can support. Gather assignment or submission requirements, your source inventory, available data descriptions, and the deadline. If these are missing, record a provisional scope and open questions. A proposed study is not a completed finding. Start with a one-sentence question, then define its boundaries.

## Research question and purpose
Ask: “For which people or objects, in which setting, what phenomenon or relationship will I examine?” Enter the main question: [Enter]. Identify the audience and the decision or understanding this answer could inform. Separate your motivation, tentative hypothesis, and proposed contribution. For each subquestion, describe the evidence needed to answer it; a claim to fill a gap is not sufficient by itself.

## Included and excluded scope
| Dimension | Included | Excluded and why | Open decision |
| --- | --- | --- | --- |
| Population, location, period | [Enter] | [Enter] | [Enter] |
| Key concepts and definitions | [Enter] | [Enter] | [Enter] |
| Data or publication types | [Enter] | [Enter] | [Enter] |
Explain why neighboring topics are outside this study. Any expansion should state its effect on time, sources, and methods.

## Evidence and feasibility
List the publications, data, or original records needed for each question. Mark each as obtained, requestable, or not located. Point to actual files, database records, or accessible addresses and identify versions. Record access conditions, sampling limits, analytical capabilities, and available time. Where participants or sensitive records are involved, establish which review and use conditions apply and whether they are satisfied. If essential evidence cannot be obtained, narrow the question or defer the affected conclusion.

## Success criteria and schedule
Enter the deliverable, length, citation style, and deadline: [Enter]. Separate the minimum defensible outcome from optional extensions. What evidence would contradict your expectation? How will insufficient evidence be reported? Assign dates, owners, outputs, and continuation conditions for collection, method decisions, drafting, and verification.

## Worked example
Fictional research plan, not an actual finding or reference: “Examine how students in two classes at one school use reading notes during a four-week course.” Include voluntarily supplied notes and interviews; exclude grade comparisons and generalizations to other schools. If interview permission is unavailable, analyze only anonymous notes whose use is permitted. The intended output is a description of usage patterns. Their number and effects remain unknown until analysis.

## Completion checklist
- [ ] The main question specifies its subject and setting; every subquestion has an evidence need.
- [ ] Inclusion, exclusion, availability, and use conditions are explicit.
- [ ] Hypotheses and plans are distinguishable from observed findings.
- [ ] Deliverables, dates, and treatment of missing evidence are realistic.

## Related documents
Pass questions, terminology, and inclusion criteria to “Literature review.” Pass evidence needs, available materials, and limitations to “Method analysis.” Date and explain scope changes, then update “Draft chapters” so the manuscript addresses the current question.`,
  },
  'literature-review': {
    zh: `## 填写前
本页用于说明已有研究怎样回答你的问题、彼此如何分歧，以及你的研究接在哪里。准备“研究范围”、已取得的论文或书籍、检索记录与引用格式要求。只读到摘要时明确标记；找不到全文就记录获取动作，不根据标题补造观点、页码或结论。

## 检索问题与边界
把主问题拆成核心概念、同义词和相关表达，分别写中英文检索词。记录检索平台、日期、检索式、时间范围和语言限制；手工追踪参考文献也要记入口。说明纳入标准与排除理由，例如对象不同、材料无法核实，而不是仅选择支持自己观点的文章。尚未检索的平台列入待办。

## 文献证据卡
| 来源定位 | 阅读范围 | 研究对象与方法 | 可支持的判断 | 限制或疑问 |
| --- | --- | --- | --- | --- |
| [真实题名、作者、年份、地址或文件] | [全文/摘要、页或节] | [填写] | [填写] | [填写] |
为直接引语保存原文和准确位置；转述也保留对应段落位置。区分作者声称的结论与你的评价，不以引用次数代替质量判断。

## 主题比较与综合
围绕问题组织段落，不按“一篇一段”罗列。每个主题先写共同发现，再比较不同对象、定义、方法或时间背景带来的差异。填写“主题判断—支持来源—相反证据—适用条件”。若两篇看似矛盾，先检查测量和研究情境是否一致，再决定能否合并讨论。

## 研究缺口与后续问题
哪些问题已有较可靠回答？哪些仅有间接证据？把缺口分成资料不足、方法限制和结果不一致，并说明与本研究的关系。证据少不等于研究空白；检索尚不充分时使用“在本次检索范围内尚未找到”。列出待补全文、待查定义和需要调整的子问题。

## 填写示例
以下为虚构资料卡示例，不能作为真实参考文献：假设材料甲描述学生用笔记复述内容，材料乙描述学生用笔记提出问题。综合句可写为“这两份待核实材料使用了不同的笔记分类，因此当前不能直接比较其比例”。来源栏写“示例材料，待替换”，不要给它编造作者、期刊或 DOI。

## 完成检查
- [ ] 检索范围、日期、纳入标准与未覆盖部分均有记录。
- [ ] 每条文献判断能回到真实来源及页码、章节或段落。
- [ ] 综合段落比较了证据和限制，也保留相反观点。
- [ ] 摘要阅读、待核实来源和暂定缺口清楚标注。

## 文档衔接
将主题综合、争议点和可核实来源交给“章节起草”；将已有方法及局限交给“方法分析”；把原文位置、转述和未取得全文清单交给“引文核验”。若问题需要收窄，回填“研究范围”。`,
    en: `## Before you start
Explain how existing work addresses your question, where accounts differ, and how your study connects. Gather “Research scope,” available publications, search records, and citation requirements. Mark abstract-only reading. When full text is unavailable, record how to obtain it; never infer findings, page numbers, or arguments from a title.

## Search questions and boundaries
Break the research question into concepts, synonyms, and related expressions. Include relevant terms in each search language. Record platforms, dates, exact queries, date ranges, and language limits. Record starting sources for reference-list searches too. State inclusion and exclusion reasons, such as a different population or unverifiable material. Do not include only papers that support your expectation. List platforms still to search.

## Evidence cards
| Source locator | Material actually read | Population and method | Claim it supports | Limit or question |
| --- | --- | --- | --- | --- |
| [Actual title, author, year, address or file] | [Full text/abstract, page or section] | [Enter] | [Enter] | [Enter] |
Keep exact wording and locations for quotations, and passage locations for paraphrases. Distinguish an author's conclusion from your assessment. Citation counts alone do not establish evidence quality.

## Compare and synthesize themes
Organize around questions instead of listing one paragraph per publication. For each theme, identify agreement, then examine differences in populations, definitions, methods, or periods. Use the outline “theme claim → supporting sources → contrary evidence → conditions.” Before treating two findings as contradictory, check whether they measure the same thing in comparable settings.

## Gaps and next questions
Which questions have substantial support, and which rely on indirect evidence? Distinguish missing material, method limitations, and inconsistent findings. Explain why each matters to your study. Few retrieved results do not establish a research gap. For incomplete searches, write “not located within this search scope.” List missing full texts, definitions to verify, and subquestions that may need revision.

## Worked example
Fictional evidence-card illustration; these are not real references. Suppose material A describes notes used to retell content and material B describes notes used to ask questions. A synthesis could read: “These two unverified materials classify notes differently, so their proportions cannot yet be compared.” Label the source field “example material; replace with a verified source.” Do not invent authors, journals, or DOIs.

## Completion checklist
- [ ] Search dates, boundaries, inclusion criteria, and uncovered areas are recorded.
- [ ] Each source-based claim points to a real source and a page, section, or passage.
- [ ] The synthesis compares evidence and limitations and includes contrary views.
- [ ] Abstract-only reading, unverified sources, and provisional gaps are labeled.

## Related documents
Send thematic synthesis, disagreements, and traceable sources to “Draft chapters.” Send relevant methods and limitations to “Method analysis.” Give “Verify citations” passage locations, paraphrases, and the missing-full-text list. Revise “Research scope” if the evidence requires a narrower question.`,
  },
  'method-analysis': {
    zh: `## 填写前
本页说明研究问题如何被转成可执行、可复核的分析。准备“研究范围”、真实数据说明、可用工具及“文献综述”中的相关方法。尚无数据时填写分析计划，结果栏保留“未执行”；不要用示意数字填充实际结果，也不要把预计能获得的数据写成已取得。

## 问题到方法的对应
| 子问题 | 所需材料与单位 | 拟用方法 | 选择理由 | 不能回答什么 |
| --- | --- | --- | --- | --- |
| [填写] | [对象、记录、时期] | [填写] | [填写] | [填写] |
为每种方法解释它为什么适合当前材料。可以是文本分析、访谈编码、比较研究或统计分析，按课题选择，不能因工具方便而替换研究问题。列出一个可行替代方法及取舍。

## 数据与处理规则
说明来源、获取日期、版本、纳入排除条件和分析单位。逐步填写清理、去重、缺失处理和变量定义；质性研究写编码单位、分类规则及分歧处理。原始材料与加工副本分开保存，记录变更；涉及敏感资料时说明实际适用的匿名化、访问和使用条件。样本量未知就写待确认。

## 可复现的分析步骤
按顺序写“输入—操作—输出—核查方法”。统计分析记录公式或程序版本、参数及适用前提检查；质性分析提供编码定义和边界案例，并说明谁参与解释。把尚待决定的阈值标为待定，注明决定依据；实际分析后如有偏离原计划，记录时间、原因及影响。

## 结果解释与局限
计划如何区分观察、推断与解释？预先写明不支持原假设时的报告方式。说明缺失资料、选择偏差、测量方式或研究情境可能怎样影响结论。根据方法选择敏感性分析、反例检查或不同解释的比较，填写需要何种证据才能提高判断把握，避免把相关关系直接写成因果。

## 填写示例
以下为虚构分析计划，尚未执行：对获准使用的阅读笔记，以一段为编码单位，暂设“复述”“提问”“联系经验”，允许一段多类。先用少量材料试编码；无法归类的段落进入备忘录，修改规则后重新检查早期材料。此例只演示方法，不宣称类别已经得到验证，也不填写比例或显著性。

## 完成检查
- [ ] 每个子问题都有匹配的方法，并说明适用前提与回答边界。
- [ ] 数据状态、处理步骤和关键定义可由另一位读者复核。
- [ ] 未执行计划与实际操作、结果明确分开。
- [ ] 局限、替代解释和计划变更的记录方式已经写明。

## 文档衔接
将方法步骤、真实执行记录和局限交给“章节起草”；将所用方法的来源与具体位置交给“引文核验”。数据不足以回答问题时更新“研究范围”；需要新方法证据时回到“文献综述”。`,
    en: `## Before you start
Explain how the research question becomes an executable, reviewable analysis. Gather “Research scope,” real data descriptions, available tools, and relevant methods from “Literature review.” If data are not yet available, write an analysis plan and mark results “not run.” Illustrative numbers must not become actual results, and expected access must not be described as obtained access.

## Match questions to methods
| Subquestion | Evidence and unit | Proposed method | Why it fits | What it cannot answer |
| --- | --- | --- | --- | --- |
| [Enter] | [Objects, records, period] | [Enter] | [Enter] | [Enter] |
Explain the fit between each method and the available material. Choose textual analysis, interview coding, comparison, statistical analysis, or another justified approach. A convenient tool should not replace the research question. Identify one feasible alternative and explain the tradeoff.

## Data and processing rules
State sources, acquisition dates, versions, inclusion rules, and analytical units. Describe cleaning, deduplication, missing-data treatment, and variable definitions. For qualitative work, define coding units, categories, and disagreement handling. Preserve originals separately from processed copies and record changes. Describe applicable anonymization, access, and use conditions for sensitive material. Mark an unknown sample size as unresolved.

## Reproducible analysis steps
Write each step as “input → operation → output → check.” For statistical work, record formulas or program versions, parameters, and assumption checks. For qualitative work, provide code definitions, boundary cases, and who participates in interpretation. Mark undecided thresholds as pending and state their decision basis. After execution, document departures from the plan with dates, reasons, and consequences.

## Interpretation and limitations
How will observations, inferences, and explanations be distinguished? State how findings contrary to expectations will be reported. Explain how missing material, selection, measurement, or setting could affect conclusions. Choose suitable sensitivity checks, negative-case analysis, or comparisons of competing explanations. Describe what additional evidence would strengthen a judgment. Do not turn an association into a causal claim without justification.

## Worked example
Fictional, unexecuted analysis plan: code permitted reading notes by paragraph using provisional categories “retelling,” “questioning,” and “connecting to experience,” allowing multiple categories. Pilot the definitions on a small subset. Put unclassifiable passages in a memo; after changing a definition, revisit earlier material. This illustrates a procedure, not validated categories or observed proportions. No significance or effect is asserted.

## Completion checklist
- [ ] Each question has a suitable method, assumptions, and explicit limits.
- [ ] Data status, processing steps, and definitions are reviewable.
- [ ] Planned work is separate from performed operations and findings.
- [ ] Limitations, alternative explanations, and plan-change records are specified.

## Related documents
Pass methods, actual execution records, and limitations to “Draft chapters.” Send source locations for adopted methods to “Verify citations.” Update “Research scope” if the data cannot answer the question. Return to “Literature review” when a method needs further supporting evidence.`,
  },
  'draft-chapters': {
    zh: `## 填写前
本页把研究问题、文献综合和方法记录组织成可修改的论文正文。准备“研究范围”“文献综述”“方法分析”及学校或期刊要求。没有执行结果时可以起草引言和方法计划，但结果部分须标明未执行；缺少来源的论断标记待补证，不让流畅表述掩盖证据空缺。

## 章节骨架与任务
按学科要求调整结构，不必强行套用实验论文格式。先为每章写一句“本章回答什么”。可编辑骨架：引言提出问题与意义；相关研究比较已有解释；方法说明材料和步骤；分析或结果呈现证据；讨论回应问题与替代解释；结论概括贡献与边界。每章填写计划字数、现有材料和缺口。

## 论点与证据配置
| 章节或段落 | 核心论点 | 实际证据及定位 | 当前状态 | 待补动作 |
| --- | --- | --- | --- | --- |
| [填写] | [一句可检验的判断] | [来源、页/节或数据记录] | [可写/待核实/未分析] | [填写] |
先写证据充分的段落。一个段落围绕一个主要判断，依次写判断、证据、解释及与问题的关系；出现相反证据时解释差异，不直接删除。

## 章节正文填写区
上面的骨架和证据表用于规划；本区填写可连续阅读的成文正文，不以提纲或修改清单替代。按已确认的大纲逐章重复以下结构，写明本次草稿版本：[填写版本、日期及覆盖章节]。

### [填写章节编号与标题]
[填写本章完整正文，包括论述、证据解释与必要的小节；来源保留可核验定位。]

[填写本章图表及说明，或注明本章无图表。未执行分析保留明确状态，不补造结果。]

### [填写下一章编号与标题]
[填写下一章完整正文，按已确认章节继续添加。尚未成文的章节明确标为待起草。]

## 方法和结果的写法
将计划步骤与实际执行记录对照，正文使用准确时态。结果只写确实观察到的内容；图表注明数据来源、单位、样本范围和生成方法。没有数据的图表只保留题目与待填说明。讨论中明确哪些解释由证据支持，哪些是推测；研究未完成时不要提前写“研究证明”。

## 版本与修订记录
为草稿记录版本日期、章节状态和修改原因。列出需要作者决定的问题，例如术语冲突、论点跨度过大或证据不足。收到修改意见后，记“原问题—处理方式—修改位置—仍待确认”，避免只勾选完成却无法定位变化。摘要在正文稳定后核对，不添加正文没有的信息。

## 填写示例
以下为虚构写作练习，不是研究结论：“本研究拟描述阅读笔记中的提问方式。分析尚未执行，本节暂列编码规则和预期输出形式。”这比“研究表明提问显著提高理解”更符合当前证据状态。若后来取得真实结果，应替换为带材料位置的观察，再讨论可能解释，而不是沿用示例作为事实。

## 完成检查
- [ ] 每章有明确任务，并共同回应“研究范围”中的问题。
- [ ] 本次覆盖的章节已填写成文正文，规划表与正文分开，未起草章节明确列出。
- [ ] 主要论点对应实际证据，待补证和未分析部分可见。
- [ ] 计划、执行、结果与解释的表述没有混用。
- [ ] 图表、摘要、结论未添加正文不能支持的数字或判断。

## 文档衔接
把带版本号的正文、引语位置和参考文献清单交给“引文核验”；把结构、术语和修订问题交给“学术编辑”。证据缺口回传“文献综述”，方法与执行不一致之处回传“方法分析”，并保留修改记录。`,
    en: `## Before you start
Turn the research question, source synthesis, and method records into a revisable manuscript. Gather “Research scope,” “Literature review,” “Method analysis,” and venue requirements. Without executed analysis, you can draft an introduction and a method plan, but label results as unperformed. Mark unsupported claims for evidence; polished prose must not conceal missing support.

## Chapter outline and purpose
Adapt the structure to your discipline instead of forcing an experimental format. Give each chapter a one-sentence purpose. An editable outline is: introduction—question and significance; related work—comparison of explanations; methods—material and procedure; analysis or results—evidence; discussion—answers and alternatives; conclusion—contribution and boundaries. Enter target length, available material, and gaps for each chapter.

## Claim and evidence map
| Chapter or paragraph | Main claim | Actual evidence and locator | Status | Next action |
| --- | --- | --- | --- | --- |
| [Enter] | [One assessable claim] | [Source and page/section or data record] | [Ready/unverified/unanalyzed] | [Enter] |
Begin with well-supported passages. Build a paragraph around a principal claim, evidence, interpretation, and relevance to the question. Retain contrary evidence and explain its implications instead of deleting it.

## Chapter manuscript area
The outline and evidence table above are planning aids. Write continuously readable prose here; an outline or revision list does not replace the manuscript. Repeat this structure for every agreed chapter and identify this draft: [Enter version, date, and chapters covered].

### [Enter chapter number and title]
[Write the complete chapter, including argument, evidence interpretation, and necessary subsections. Retain verifiable source locators.]

[Insert this chapter's figures, tables, and captions, or state that none are used. Keep unperformed analysis explicitly labeled; do not invent results.]

### [Enter next chapter number and title]
[Write the next complete chapter and continue through the agreed outline. Explicitly mark unwritten chapters as pending.]

## Writing methods and results
Compare intended procedures with execution records and use accurate tense. Report only observations that actually occurred. Give figures and tables their data sources, units, sample boundaries, and production methods. For missing data, retain a caption and pending-material note rather than filling invented values. Separate supported interpretations from conjecture. An unfinished study must not be described as having demonstrated an outcome.

## Version and revision log
Record draft dates, chapter status, and reasons for changes. List author decisions, such as conflicting terminology, overbroad claims, or insufficient evidence. For feedback, record “issue → response → changed location → unresolved question.” A completion tick alone cannot show what changed. Check the abstract after the body stabilizes and add nothing absent from the manuscript.

## Worked example
Fictional writing exercise, not a research finding: “This study proposes to describe questioning in reading notes. Analysis has not been performed; this section currently specifies coding rules and intended outputs.” This matches the evidence state better than claiming that questioning significantly improves understanding. Once real results exist, replace the note with traceable observations followed by appropriately qualified interpretations. Do not retain illustrative material as fact.

## Completion checklist
- [ ] Each chapter has a clear purpose and contributes to the research question.
- [ ] Covered chapters contain actual prose separate from planning tables, and unwritten chapters are listed.
- [ ] Main claims have actual evidence; unresolved and unanalyzed material is visible.
- [ ] Planned work, performed work, findings, and interpretation remain distinct.
- [ ] Figures, abstract, and conclusion contain no unsupported values or claims.

## Related documents
Give “Verify citations” the versioned manuscript, quotation locations, and reference list. Give “Academic edit” structural, terminology, and revision questions. Return evidence gaps to “Literature review” and discrepancies between intended and performed methods to “Method analysis,” preserving the revision record.`,
  },
  'verify-citations': {
    zh: `## 填写前
本页逐条核对正文的引语、转述、数字和参考文献是否可追溯且确实受到来源支持。准备同一版本的“章节起草”、参考文献表与真实全文或原始记录。无法访问来源时标为未核验并列出获取动作；只核对题名或链接能打开，不能据此宣布论断已获证实。

## 核验对象清单
给每项引用分配稳定编号，记录正文版本及章节、段落或句子。除了显式引号，也检查转述、表格数据、方法来源和“普遍认为”等概括。明确本轮覆盖哪些章节、尚未检查哪些部分，避免把抽查结果说成全文通过。

## 逐条对照记录
| 编号与正文位置 | 待核验表述 | 来源与原文位置 | 对照结论 | 修订动作 |
| --- | --- | --- | --- | --- |
| [填写] | [原句] | [真实文件/地址、页/节/段] | [支持/部分支持/不支持/未核验] | [填写] |
直接引语逐字比对，检查省略是否改变含义；译文保存原文并说明翻译方式。转述核对对象、条件、方向和强度，特别检查是否把“可能”“相关”改成了“必然”“导致”。

## 书目信息与定位
从实际出版页面或材料本身核对作者、题名、年份、版本及标识符；没有 DOI 的材料不补造 DOI。网页记录实际可访问地址与访问日期，电子书写明版本和可稳定定位的章节。使用二手转引时标明实际读到的是哪一份材料，不冒充已经阅读原始来源。

## 问题处置与复核
来源存在但不支持原句时，缩小论断、补充适当证据或删除该句，并保留理由。对未取得全文、版本冲突和无法定位分别记录负责人、下一步与状态。检查正文引用与文末条目双向对应；修改后重新核对相关句子及前后语境，避免数字或结论在别处仍保留旧写法。

## 填写示例
以下是虚构核验练习，没有对应真实文献。示例来源写“部分受访者提到使用笔记”，草稿却写“所有学生都依赖笔记”。结论应为“不支持该范围”，建议改成“在该访谈材料中，部分受访者提到使用笔记”，并待真实来源补齐准确位置。不能给示例编造作者、页码或出版记录来使它看似完整。

## 完成检查
- [ ] 已核验项目都能定位到实际读过的原文，未取得材料明确列出。
- [ ] 引语准确，转述保留原文的对象、条件与判断强度。
- [ ] 正文引用与参考文献对应，书目信息没有猜填。
- [ ] 修订已复核，报告说明覆盖范围及剩余未核验项。

## 文档衔接
把逐条核验表、修订句与未解决项交回“章节起草”；把已核验的正文版本和引用格式问题交给“学术编辑”。来源缺失或主题判断需要重做时回到“文献综述”。核验报告应随正文版本更新，不能沿用旧版本的通过结论。`,
    en: `## Before you start
Check whether quotations, paraphrases, numbers, and references are traceable and actually support the manuscript. Gather one consistent version of “Draft chapters,” its bibliography, and real full texts or original records. If a source is inaccessible, mark it unverified and state how to obtain it. Matching a title or opening a link does not verify the claim.

## Verification inventory
Assign stable IDs and record the manuscript version and chapter, paragraph, or sentence. Include paraphrases, table values, adopted methods, and broad statements such as “it is widely accepted,” as well as explicit quotations. State which chapters this pass covers and which remain unchecked. A spot check is not full-manuscript verification.

## Item-by-item comparison
| ID and manuscript location | Claim being checked | Source and passage locator | Finding | Revision |
| --- | --- | --- | --- | --- |
| [Enter] | [Original sentence] | [Actual file/address, page/section/passage] | [Supported/partial/unsupported/unverified] | [Enter] |
Compare direct quotations word for word and assess whether omissions alter meaning. Keep originals alongside translations and describe the translation approach. For paraphrases, check population, conditions, direction, and claim strength. Watch for “may” becoming “must” or association becoming causation.

## Bibliographic details and locators
Verify authors, title, year, version, and identifiers against the actual publication record or material. Do not create a DOI for a source that has none. For web material, record the address actually accessed and access date. For electronic books, identify edition and a stable chapter or other locator. If using a secondary quotation, identify the material you actually read rather than implying access to the original.

## Resolve issues and recheck
If a source exists but does not support the sentence, narrow the claim, supply suitable evidence, or remove it and record why. Track missing full texts, conflicting editions, and unlocatable passages separately, with owners, actions, and statuses. Check references in both directions between body and bibliography. Recheck revised wording in context and inspect other locations for outdated numbers or conclusions.

## Worked example
Fictional verification exercise with no real reference: an illustrative source says “some interviewees mentioned using notes,” while the draft says “all students depend on notes.” Record “scope unsupported” and propose “In these interview materials, some interviewees mentioned using notes,” pending a real source and precise locator. Do not invent authors, pages, or publication records to make the illustration appear complete.

## Completion checklist
- [ ] Verified items locate original passages actually read; unavailable material is listed.
- [ ] Quotations are accurate and paraphrases preserve conditions and claim strength.
- [ ] In-text references match bibliography entries without guessed details.
- [ ] Revisions were rechecked and remaining coverage gaps are reported.

## Related documents
Return the verification table, corrected sentences, and unresolved issues to “Draft chapters.” Give “Academic edit” the verified manuscript version and citation-format issues. Return missing-source and synthesis problems to “Literature review.” Verification is version-specific; an earlier pass cannot automatically certify a changed manuscript.`,
  },
  'academic-edit': {
    zh: `## 填写前
本页帮助你在证据边界内改善论文结构、表达和交付一致性。准备最新“章节起草”“引文核验”及实际投稿或课程格式要求，先记编辑所依据的版本。尚未核验的论断保留标记；文字润色不能把未完成研究变成已完成，也不能替作者新增结果。

## 结构与论证审阅
逐章回答：这一章服务哪个研究问题？结论前是否给出充分证据？段落之间缺少什么推理步骤？列出重复、跳跃、离题和需要移位的内容。区分结构调整与语言修改，先解决论证问题，再润色句子；建议删减时写明可能损失的证据或解释。

## 术语与表达约定
| 项目 | 本文采用写法 | 不一致位置 | 处理原则 |
| --- | --- | --- | --- |
| 核心术语及缩写 | [填写] | [章节/段落] | [首次定义、后文统一] |
| 时态与论断强度 | [填写] | [章节/段落] | [对应计划、执行或解释] |
| 数字、单位和图表称谓 | [填写] | [章节/段落] | [按实际格式要求] |
检查长句的主语与指代，拆分包含多个判断的句子。保留学科必要术语，但为目标读者解释首次出现的概念；不把个人偏好的句式当成通用学术规范。

## 修改记录与作者决定
记录“原文—建议文本—理由—是否影响含义—作者决定”。仅改表达的修改可以直接比较；涉及因果、显著性、范围或研究贡献的改写要回到证据确认。为未解决问题明确写出需要补什么材料或做什么决定，不用更肯定的词掩盖不确定性。

## 完整修订正文
本页是学术编辑后的完整最终稿输出。保留前面的编辑依据与记录，并在本区按已确认章节顺序粘贴或写入全部修订正文，不只列修改意见，也不只放有改动的段落。记录最终稿版本、日期、依据的源稿版本、采用的章节及修订方案：[填写]。未改动的章节也完整收入，章节缺失时标记待补，不能声称整稿完成。

### 题名、摘要与关键词
[填写最终题名、完整摘要和关键词，按本稿实际要求设置。]

### [填写已确认章节编号与标题]
[填写本章完整修订正文，含必要小节、引文和图表说明；按确认大纲逐章重复此结构。]

### 参考文献与附件
[填写与正文对应的完整参考文献；按实际要求收入附件，或说明无附件。]

本区应可独立作为整稿阅读和交付。编辑记录与待决问题放在正文之外；凡仍影响论证或来源可靠性的问题，明确保留其状态并等待解决。

## 交付前一致性核对
按实际要求检查标题层级、摘要、关键词、图表编号、交叉引用、参考文献和附件。比较摘要、正文、结论中的对象、数字及限制是否一致。分别标记内容编辑、引文核验、格式整理和作者确认的状态；任何一个完成都不自动代表其他项完成。填写交付文件版本与剩余问题。

## 填写示例
以下为虚构语言编辑示例，不含真实研究发现。原句：“本研究彻底证明了阅读笔记一定有效。”若当前只有方法计划，改为“本研究拟考察阅读笔记的使用方式，效果尚待证据检验。”理由是恢复真实研究状态，而非单纯降低语气。若已有真实结果，须依据结果范围另写，不能机械套用示例。

## 完成检查
- [ ] 结构服务研究问题，主要论证跳跃已有处理或明确记录。
- [ ] 核心术语、时态、单位和引用称谓一致。
- [ ] 改写没有放大证据强度，影响含义的改动得到单独确认。
- [ ] 摘要与结论匹配正文，交付版本与未解决项清晰可见。
- [ ] 本页已收齐确认范围内的完整修订章节、参考文献及必要附件，采用版本明确，正文无未填写占位，影响交付的未决问题已解决。

## 文档衔接
本页“完整修订正文”承接学术编辑的最终整稿输出；“章节起草”的源稿保留供版本对照，不以返回源稿替代本页整稿。需要补证或重写的条目交回“章节起草”处理后，将采用正文合入本页；改动过的引语、转述与引用交给“引文核验”复查。方法表述改变时对照“方法分析”，范围改变时同步“研究范围”。最终保留完整正文、采用版本、修改记录及残留问题清单。`,
    en: `## Before you start
Improve structure, clarity, and delivery consistency without exceeding the evidence. Gather the latest “Draft chapters,” “Verify citations,” and actual submission or assignment rules. Record the manuscript version being edited. Keep unverified claims visible: language editing cannot turn planned research into completed work or introduce new findings for the author.

## Structure and argument review
For each chapter ask: Which research question does it serve? Does evidence precede its conclusions? Which inferential steps are missing? List repetition, jumps, digressions, and material that should move. Separate structural changes from sentence editing and repair arguments first. For proposed cuts, identify any evidence or explanation that would be lost.

## Terminology and expression
| Item | Preferred form in this paper | Inconsistent location | Editing principle |
| --- | --- | --- | --- |
| Core terms and abbreviations | [Enter] | [Chapter/paragraph] | [Define first, then use consistently] |
| Tense and claim strength | [Enter] | [Chapter/paragraph] | [Match plans, execution, or interpretation] |
| Numbers, units, figure labels | [Enter] | [Chapter/paragraph] | [Follow actual requirements] |
Check subjects and pronoun references in long sentences. Separate sentences containing multiple claims. Retain necessary disciplinary terms while explaining unfamiliar concepts for the intended reader. Personal stylistic preferences are not universal academic rules.

## Revision log and author decisions
Record “original → proposed wording → reason → meaning affected? → author decision.” Compare purely verbal edits directly. Changes involving causation, significance, scope, or contribution require evidence review. Specify the material or decision needed for unresolved issues instead of masking uncertainty with more confident language.

## Complete revised manuscript
This page is the complete final manuscript output from academic editing. Retain the editing rationale and log above, then insert every revised chapter here in the agreed order. Do not provide only comments or changed passages. Record the final version, date, source-draft version, included chapters, and adopted revision choices: [Enter]. Include unchanged chapters in full too. Mark missing chapters as pending and do not claim manuscript completion while they are absent.

### Title, abstract, and keywords
[Enter the final title, complete abstract, and keywords as required for this manuscript.]

### [Enter agreed chapter number and title]
[Insert the complete revised chapter with necessary subsections, citations, and figure or table captions. Repeat for every chapter in the agreed outline.]

### References and supplements
[Insert the full bibliography matching the body. Include required supplements or state that none apply.]

This area should stand alone as a readable, deliverable manuscript. Keep editing logs and open decisions outside the prose. Explicitly retain the status of unresolved issues affecting arguments or source reliability until they are resolved.

## Delivery consistency
Check heading levels, abstract, keywords, figure and table numbers, cross-references, bibliography, and supplements against the actual requirements. Compare populations, numbers, and limitations across abstract, body, and conclusion. Track content editing, citation verification, formatting, and author acceptance separately; completion of one does not establish completion of the others. Record the delivery version and unresolved items.

## Worked example
Fictional language-editing exercise, not a research result. Original: “This study conclusively proves that reading notes always work.” If only a method plan exists, revise to “This study proposes to examine how reading notes are used; effects remain to be tested with evidence.” The reason is to restore the actual study status, not merely soften the tone. If real results exist, write a claim suited to their scope rather than copying this example mechanically.

## Completion checklist
- [ ] Structure supports the research question and major argument gaps are resolved or logged.
- [ ] Terminology, tense, units, and reference labels are consistent.
- [ ] Edits do not strengthen unsupported claims; meaning changes are separately confirmed.
- [ ] Abstract and conclusion match the body; the delivery version and open issues are clear.
- [ ] This page contains all agreed revised chapters, references, and required supplements; the adopted version is identified, manuscript placeholders are filled, and delivery-blocking issues are resolved.

## Related documents
The “Complete revised manuscript” area on this page is the final complete output of academic editing. Preserve the source in “Draft chapters” for version comparison; returning to the source does not replace assembling the manuscript here. Resolve evidence gaps and substantive rewrites through “Draft chapters,” then incorporate accepted prose into this page. Send changed quotations, paraphrases, and references to “Verify citations.” Compare method changes with “Method analysis” and synchronize scope changes with “Research scope.” Retain the complete manuscript, adopted version, revision record, and residual-issue list.`,
  },
  'world-bible': {
    zh: `## 填写前
本页建立故事中会影响人物选择和情节后果的世界规则。准备题材想法、已有片段、地图或资料笔记；先写故事马上用到的设定，不必先造完整百科。没有确定的内容标为“暂定”，与已在正文出现的事实分开。现实题材的资料缺口另列待查，不把猜测写成真实常识。

## 类型、基调与观察范围
填写类型或混合类型、目标读者、故事规模及整体基调：[填写]。故事发生在何时何地？主角能看见哪些社会层面，哪些只听过传闻？明确叙述视角、时间表达方式和超自然元素是否存在。这些都是本书的创作选择，可按作品修改，不是所有小说都必须遵守的规则。

## 世界规则与代价
| 规则编号 | 确定事实或暂定设想 | 触发条件与代价 | 例外及原因 | 首次出现位置 |
| --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [填写] | [章节或未写] |
为技术、魔法、制度或资源写清“能做什么、不能做什么、谁能使用、失败会怎样”。例外不能只为解决当前危机而出现；若决定加入，说明铺垫位置以及对其他情节的影响。

## 地理、社会与日常
围绕剧情填写关键地点间的距离、交通时间、通信方式和季节限制。记录权力由谁掌握、交易使用什么、普通人怎样工作与生活，以及这些安排造成什么冲突。只细化进入场景的细节；地图没有确定比例时不要写出互相矛盾的精确行程。

## 正式设定与变更记录
把已确认事实、人物误解、民间传说和作者待定想法分别标注。为每次修改写旧设定、新设定、理由及受影响章节。若正文与设定冲突，明确选择修正文还是调整规则，再检查人物知识和后续后果，避免两套版本同时保留。

## 填写示例
以下是可替换的原创虚构示例：雾港的渡船每日退潮时通航一次，错过只能等次日。角色在第二章错过渡船，因此第三章不能无解释地出现在对岸；可改为次日到达，或提前铺垫有代价的私船。私船是否存在是作者决定，若采用，须同时说明费用、风险和为何人人不能轻易使用。

## 完成检查
- [ ] 关键规则写清能力、限制与代价，暂定内容有标记。
- [ ] 地点、行程、通信和时间条件能够支持当前剧情。
- [ ] 事实、传闻与角色认知区分明确。
- [ ] 设定变化记录了受影响章节，并有一致的处理决定。

## 文档衔接
把世界限制、社会关系与生活细节交给“角色设定”；把会制造障碍或提供资源的规则交给“故事大纲”。向“章节写作”提供当前有效设定，向“连续性检查”提供规则编号、首次出现位置与变更记录。`,
    en: `## Before you start
Define world rules that affect character choices and plot consequences. Gather your premise, existing scenes, maps, or research notes. Start with what the story needs now; a complete encyclopedia is unnecessary. Separate tentative ideas from facts already established in the manuscript. For realistic settings, list research gaps instead of presenting guesses as real-world knowledge.

## Genre, tone, and field of view
Enter the genre or blend, intended readers, story scale, and tone: [Enter]. Where and when does the story occur? Which parts of society can the protagonist observe, and which are only rumored? Choose narrative viewpoint, time conventions, and whether supernatural elements exist. These are configurable choices for this book, not universal writing rules.

## Rules and costs
| Rule ID | Established fact or tentative idea | Conditions and costs | Exceptions and reasons | First appearance |
| --- | --- | --- | --- | --- |
| [Enter] | [Enter] | [Enter] | [Enter] | [Chapter or unwritten] |
For technology, magic, institutions, or resources, explain capabilities, limits, access, and failure consequences. Do not invent an exception solely to escape the current crisis. If introducing one, specify its setup and effects on other events.

## Geography, society, and daily life
Record distances, travel times, communication, and seasonal restrictions relevant to the plot. Who holds power? How do people trade, work, and live? Which conflicts arise from these arrangements? Develop details used in scenes first. If map scale is undecided, avoid incompatible precise journey times.

## Canon and change history
Label established facts, character misconceptions, folklore, and undecided author ideas separately. For each change, record old rule, new rule, reason, and affected chapters. When manuscript and guide conflict, explicitly choose whether to revise the prose or the rule. Then inspect character knowledge and downstream consequences so two versions do not remain active.

## Worked example
Replaceable original fictional example: the ferry in Mist Harbor crosses once daily at low tide. A character misses it in chapter two and therefore cannot simply appear across the water in chapter three. Revise the arrival to the next day, or establish a costly private boat earlier. Whether that boat exists is an author decision; if adopted, explain its price, risks, and why everyone cannot use it freely.

## Completion checklist
- [ ] Important rules specify capabilities, limits, and costs; tentative ideas are labeled.
- [ ] Geography, travel, communication, and timing support current events.
- [ ] Facts, rumors, and character beliefs are distinguishable.
- [ ] Changes identify affected chapters and a consistent resolution.

## Related documents
Send world constraints, social relationships, and daily-life details to “Character bible.” Send rules that create obstacles or resources to “Story outline.” Give “Write chapters” the current established setting and “Continuity check” rule IDs, first appearances, and change records.`,
  },
  'character-bible': {
    zh: `## 填写前
本页让人物的行动、声音与变化有可追踪依据。准备“世界观设定”、故事前提和已有角色片段。先完成主角、主要对手及关键配角，不必一次写满所有人物。未知身世标为暂定；作者知道的秘密与人物当前知道的事情分开，避免写作时提前泄露。

## 角色目标与选择
为每个角色填写名字、角色功能、当前目标、深层需要、担忧和不愿付出的代价。追问：今天最想解决什么？失去什么会迫使其改变？在哪种压力下会做出自相矛盾的选择？用可发生的行为表达特征，例如“说谎后反复整理袖口”，不要只写“复杂、坚强”。

## 人物档案与状态
| 字段 | 当前确定内容 | 正文依据或暂定标记 | 后续可能变化 |
| --- | --- | --- | --- |
| 身份、年龄与能力限制 | [填写] | [章节/暂定] | [填写] |
| 身体、财物与随身物品 | [填写] | [章节/暂定] | [填写] |
| 说话方式与观察习惯 | [填写] | [章节/暂定] | [填写] |
人物外貌只填作品需要的细节；受伤、物品转移和能力变化都要记录发生时点，而非覆盖掉旧状态。

## 关系与知识边界
列出关键关系双方各自想得到什么、隐藏什么，以及目前信任或冲突的原因。为秘密记录“作者真相—谁知道—何时得知—通过什么证据”。角色可以误解，但要标为其信念，不能悄悄变成世界事实。多个视角时，为各视角写明允许知道的信息范围。

## 人物弧线与声音
选择本书适合的变化方式：改变、拒绝改变、逐步暴露或其他结构。写初始判断、受挑战事件、关键选择和结尾状态，不要求所有角色都成长。给主要人物各写一段面对同一问题的回应，比较词汇、句长、回避方式和注意对象，确保差别来自经历与意图，而非只靠口头禅。

## 填写示例
原创虚构示例：修钟学徒阿禾想赶上渡船，又不愿承认自己遗失通行牌。她对船工说“能不能等我把袖口理好”，动作拖延暴露焦虑。第二章她尚不知道姐姐借走通行牌，因此不能直接责怪姐姐；须先安排发现借条或他人告知，再改变其认知。是否采用此情节可由作者替换。

## 完成检查
- [ ] 主要人物有当前目标、阻力与能落到行动的特征。
- [ ] 关键秘密标注知情者、获知时点和来源。
- [ ] 身体、能力、物品和关系变化可以追踪。
- [ ] 角色声音与变化方式符合本书类型和视角选择。

## 文档衔接
把人物目标、冲突和关键选择交给“故事大纲”；把声音示例、当前状态与知识边界交给“章节写作”。向“连续性检查”提供角色状态时间线，向“风格编辑”提供已选定的声音特征；影响世界规则的背景决定回填“世界观设定”。`,
    en: `## Before you start
Give character actions, voices, and changes a traceable basis. Gather “World bible,” the premise, and existing character scenes. Start with the protagonist, principal opposition, and essential supporting cast. Mark unknown backstory as provisional. Separate secrets known to the author from information available to each character so the prose does not reveal knowledge prematurely.

## Goals and choices
For each character, enter name, story function, immediate goal, deeper need, fear, and unacceptable cost. What problem matters today? What loss could force a change? Under which pressure might this person act against their stated beliefs? Express traits through observable behavior, such as repeatedly straightening a cuff after lying, rather than adjectives alone.

## Profile and state
| Field | Current established detail | Manuscript evidence or provisional label | Possible change |
| --- | --- | --- | --- |
| Identity, age, ability limits | [Enter] | [Chapter/provisional] | [Enter] |
| Physical condition, money, possessions | [Enter] | [Chapter/provisional] | [Enter] |
| Speech and observation habits | [Enter] | [Chapter/provisional] | [Enter] |
Include appearance details useful to the book. Record when injuries, transfers, or ability changes occur instead of overwriting earlier states.

## Relationships and knowledge
For each important relationship, record what both parties want, conceal, and currently trust or resent. Track secrets as “author's truth → who knows → when learned → evidence or communication.” A mistaken belief can be intentional, but label it as belief rather than world fact. With multiple viewpoints, specify the information accessible to each.

## Arc and voice
Choose a pattern suited to this story: change, refusal to change, gradual revelation, or another structure. Describe the initial belief, challenge, decisive choice, and ending state. Every character need not undergo growth. Write short responses from different characters to the same problem. Compare vocabulary, sentence length, avoidance, and attention; differences should arise from experience and intention, not catchphrases alone.

## Worked example
Original fictional example: clockmaker's apprentice Ahe wants to catch the ferry but will not admit losing her pass. She asks the boatman, “Could you wait while I straighten my cuff?” Her delaying action reveals anxiety. In chapter two she does not yet know her sister borrowed the pass, so she cannot accuse her without first finding a note or being told. Change her knowledge after that event. Replace this plot freely to suit your book.

## Completion checklist
- [ ] Main characters have immediate goals, resistance, and observable traits.
- [ ] Secrets identify who knows, when, and through which source.
- [ ] Physical condition, abilities, possessions, and relationships are traceable.
- [ ] Voice and arc choices fit the chosen genre and viewpoint.

## Related documents
Send goals, conflicts, and decisive choices to “Story outline.” Send voice examples, current states, and knowledge boundaries to “Write chapters.” Give “Continuity check” state timelines and “Style edit” the selected voice characteristics. Return background decisions that affect world rules to “World bible.”`,
  },
  'story-outline': {
    zh: `## 填写前
本页把人物目标、世界限制和事件因果组织成可写的场景路线。准备“世界观设定”“角色设定”与故事核心想法。先写起点、主要冲突和暂定终点；结尾没决定时保留几个方案并说明差别，不必为了填表过早定死。已有正文与尚未采用的设想分别标记。

## 故事承诺与结构选择
用两三句话写主角想要什么、受到谁或什么阻碍、失败会失去什么，以及读者会持续关心什么。填写类型、目标篇幅、主要视角及时间顺序。按故事选择线性、倒叙、多线或其他结构；幕数、章长和转折频率由作品需要决定，不把某一种节拍表当成普遍要求。

## 场景与因果表
| 章节/场景 | 视角、时间与地点 | 人物目标和阻力 | 关键选择及后果 | 引出下一场的原因 |
| --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [填写] | [填写] |
检查相邻事件能否用“因为……所以……”连接。仅靠巧合转场时，考虑增加人物选择或外部后果。每场写清开场状态和结束后改变了什么；没有变化的场景可调整功能、合并或保留为有明确目的的停顿。

## 伏笔、信息与回收
列出读者需要先知道的信息、人物尚不知道的秘密以及计划何时揭示。填写“伏笔内容—埋设位置—表面解释—回收位置—回收后的影响”。误导应与已选叙述视角相容；悬念不等于任意隐瞒当前视角理应注意到的事情。尚未回收的线索标为待处理。

## 分支、节奏与修订
为重大分支写选择理由和对人物弧线、世界规则、结尾的影响。按预期阅读体验检查紧张场与缓冲场，不机械要求每章同样刺激。记录哪些场景必须写、哪些可替换，以及已经起草的段落受调整影响的范围。修改大纲后同步版本日期。

## 填写示例
原创虚构示例：阿禾错过渡船，因为不愿承认通行牌丢失；她选择去找私船，因此欠下必须修钟偿还的债；修钟时发现姐姐留下的借条，才获得下一步行动依据。若希望她当天过河，须在“世界观设定”明确私船限制，而不能忽略既有通航规则。此链条仅演示因果，可替换人物与事件。

## 完成检查
- [ ] 主要事件由目标、选择或明确外力推动，后果能连接下一场。
- [ ] 场景的视角、时间、地点及状态变化清晰。
- [ ] 关键伏笔有计划回收位置，未定分支有标记。
- [ ] 结构与节奏服务本书承诺，未违反已确认世界和角色边界。

## 文档衔接
把场景表、信息揭示顺序与必保留节点交给“章节写作”；把时间线、伏笔位置和分支决定交给“连续性检查”。人物动机变更回填“角色设定”，规则变更回填“世界观设定”；写作发现更好走向时在此记录采用理由。`,
    en: `## Before you start
Turn character goals, world constraints, and causally connected events into a route of writable scenes. Gather “World bible,” “Character bible,” and the premise. Start with the opening, main conflict, and a provisional destination. If the ending is undecided, keep alternatives and explain their differences. Separate existing manuscript events from ideas not yet adopted.

## Story promise and structure
In two or three sentences, state what the protagonist wants, what resists them, what failure costs, and what readers will want to discover. Enter genre, target length, principal viewpoint, and chronology. Choose linear narration, flashbacks, multiple threads, or another structure. Act counts, chapter lengths, and turning-point frequency depend on this book rather than a universal beat sheet.

## Scenes and causality
| Chapter/scene | Viewpoint, time, location | Goal and resistance | Choice and consequence | Why the next scene follows |
| --- | --- | --- | --- | --- |
| [Enter] | [Enter] | [Enter] | [Enter] | [Enter] |
Test whether adjacent events connect through “because” and “therefore.” Where coincidence alone moves the plot, consider a character choice or an external consequence. Record the opening state and what changes. A scene without change may need a different function, consolidation, or an intentional pause with a stated purpose.

## Setup, information, and payoff
List what readers need to know, secrets characters do not know, and planned revelations. Use “setup → placement → apparent meaning → payoff → resulting effect.” Misdirection should fit the chosen viewpoint. Suspense does not justify arbitrarily hiding what the viewpoint character would notice. Mark setups without payoffs as unresolved.

## Branches, pacing, and revisions
For major alternatives, explain the choice and consequences for character arcs, rules, and ending. Examine tension and quieter scenes against the intended reading experience; chapters need not be equally intense. Identify indispensable scenes, replaceable scenes, and drafted passages affected by changes. Date the revised outline.

## Worked example
Original fictional example: Ahe misses the ferry because she refuses to admit losing her pass. She seeks a private boat and incurs a debt payable by repairing a clock. During the repair she discovers her sister's note, gaining a reason for the next action. To put her across the water that day, establish private-boat limits in “World bible” rather than ignoring the ferry rule. This demonstrates causality; replace the characters and events as needed.

## Completion checklist
- [ ] Major events follow goals, choices, or specified external forces and produce consequences.
- [ ] Scenes identify viewpoint, time, location, and changes of state.
- [ ] Important setups have planned payoffs; undecided branches are labeled.
- [ ] Structure and pacing serve this book without violating established world or character boundaries.

## Related documents
Give “Write chapters” the scene table, revelation order, and essential events. Give “Continuity check” the timeline, setups, and branch decisions. Return motivation changes to “Character bible” and rule changes to “World bible.” If drafting suggests a better direction, record the adopted change and reason here.`,
  },
  'write-chapters': {
    zh: `## 填写前
本页用于从场景计划开始写正文，并留下下一轮修订所需的记录。准备最新“故事大纲”“角色设定”和“世界观设定”。选定本次章节范围、视角和版本日期；缺少关键设定时把问题写在正文外的写作备注，不把临时想法默认为正式设定。可以先写一场，不要求一次完成整章。

## 本章任务与起止状态
填写本章要让读者经历什么、角色想完成什么，以及结尾发生什么改变。记录开场时间、地点、在场人物、物品和已知信息；再写目标结束状态。列出必须出现的节点和可以自由发挥的空间，说明与上一章的接续及下一章的入口，避免只重复前文解释。

## 场景写作卡
| 场景 | 当前视角与目标 | 障碍或新信息 | 行动、对话与选择 | 结束状态 |
| --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [填写] | [填写] |
先写人物为目标做了什么，再补能影响感受或行动的环境细节。对话双方各想得到什么？有什么没有直说？叙述距离、内心描写比例与句子节奏按本书风格选择，不必把每场都写成同一套路。

## 正文起草区
在此开始粘贴或撰写本章正文：[填写]。写作中核对当前视角能感知和知道的信息。需要转视角或跳时，按已选结构给读者足够提示。找不到合适细节时用明显的待补备注保留位置；不要用与时代、规则或人物状态冲突的细节强行填满。

## 写后回看与偏离记录
读完一遍，检查角色选择是否可理解、场景是否产生变化、信息是否在适当时刻出现。记录偏离大纲的新增事件及理由，说明是否要回改前文。将润色问题与事实冲突分开，先修会影响后续章节的时间、知识和物品错误。保留草稿版本，修订备注不要混进最终正文。

## 填写示例
以下为原创虚构片段，供改写练习：“船工收起跳板。阿禾把空衣袋按住，问：‘下一班还等多久？’‘明早。’她望向岸边那家亮着灯的修钟铺。”它用动作呈现隐瞒，并引出下一步选择。若采用阿禾限知视角，不能紧接着直接叙述船工未说出的秘密，除非作品已经选择并提示可切换的叙述方式。

## 完成检查
- [ ] 本章有可阅读正文，起止状态和关键选择清晰。
- [ ] 视角内的信息有来源，转场和时间变化能够理解。
- [ ] 新增情节与偏离大纲之处有记录，重要设定已回填。
- [ ] 待补细节与写作备注可辨认，不会被误当成定稿内容。

## 文档衔接
把正文版本、场景时间与状态变化交给“连续性检查”，把期望的阅读感受与待润色段落交给“风格编辑”。新的关键事件回填“故事大纲”，新的人物事实或世界规则分别回填“角色设定”“世界观设定”，并标明是否已经采用。`,
    en: `## Before you start
Draft prose from scene plans while preserving useful revision records. Gather the latest “Story outline,” “Character bible,” and “World bible.” Choose the chapter range, viewpoint, and version date. Put missing-setting questions in writing notes outside the narrative; a temporary idea does not automatically become established fact. You can begin with one scene rather than completing a chapter at once.

## Chapter purpose and boundary states
Describe what readers should experience, what the character wants, and what changes by the end. Record opening time, place, present characters, possessions, and known information, then the intended ending state. Identify required events and room for invention. Explain the connection to the preceding chapter and the entrance to the next, avoiding a chapter that merely repeats exposition.

## Scene writing card
| Scene | Viewpoint and goal | Obstacle or new information | Action, dialogue, and choice | Ending state |
| --- | --- | --- | --- | --- |
| [Enter] | [Enter] | [Enter] | [Enter] | [Enter] |
Start with what the character does toward the goal, then add environmental details that affect action or experience. What does each speaker want, and what remains unsaid? Choose narrative distance, interiority, and sentence rhythm to suit the book rather than forcing every scene into one pattern.

## Manuscript drafting area
Begin or paste the chapter prose here: [Enter]. Check what the current viewpoint can perceive and know. Signal viewpoint changes or time jumps in a way consistent with the chosen structure. If a detail is unresolved, leave a visible drafting note rather than filling the space with something incompatible with the period, rules, or character state.

## Reread and record departures
Read for understandable choices, meaningful scene changes, and the timing of information. Record new events that depart from the outline, their reasons, and whether earlier passages need changes. Separate polish from factual conflicts. Repair time, knowledge, and possession errors that affect later chapters first. Keep draft versions and remove revision notes from the final narrative.

## Worked example
Original fictional passage for rewriting practice: “The boatman lifted the gangplank. Ahe pressed a hand over her empty pocket. ‘How long until the next crossing?’ ‘Tomorrow morning.’ She looked toward the lit clock shop on the quay.” Action suggests concealment and opens a new choice. With a limited Ahe viewpoint, the next sentence cannot simply disclose the boatman's unspoken secret unless the book has established and signaled a narration mode that permits that shift.

## Completion checklist
- [ ] The chapter contains readable prose with clear boundary states and consequential choices.
- [ ] Viewpoint knowledge has a source; transitions and time changes are understandable.
- [ ] Departures from the outline are logged and important new facts are recorded.
- [ ] Unfinished details and writing notes cannot be mistaken for final narrative.

## Related documents
Give “Continuity check” the manuscript version, scene times, and state changes. Give “Style edit” the intended reading experience and passages needing polish. Return major new events to “Story outline,” character facts to “Character bible,” and rules to “World bible,” marking whether each addition has been adopted.`,
  },
  'continuity-check': {
    zh: `## 填写前
本页查找时间、地点、人物知识、物品和规则之间的矛盾，并给出可定位的修订建议。准备同一版本的“章节写作”以及“世界观设定”“角色设定”“故事大纲”。先记检查范围；缺少前章时标记无法核对，不根据摘要猜出事实。作者故意安排的误解、倒叙和不可靠叙述需要结合既定叙述方式判断。

## 时间线与场景位置
按故事实际发生顺序列出事件，再注明在正文中的呈现顺序。填写日期或相对时间、持续时长、地点、交通与通信耗时。检查人物是否有足够时间到达、伤势是否经过必要过程变化，以及同时发生的场景能否成立。时间未知时标为区间，不强造精确时刻。

## 状态与信息追踪
| 对象或线索 | 前一确定状态及位置 | 后一状态及位置 | 中间变化依据 | 检查结论 |
| --- | --- | --- | --- | --- |
| [人物知识/物品/伤势/规则] | [章节、段落] | [章节、段落] | [转移、获知或改变事件] | [一致/疑问/冲突] |
物品检查持有者、数量与去向；秘密检查谁在何时通过什么方式知道；世界规则检查触发条件、代价与例外。把证据位置写到具体段落，而不只写“前后不一致”。

## 问题分级与修订方案
区分明确矛盾、缺少交代、可能的有意伏笔和仅仅风格偏好。为每个问题写影响、依据、至少一个最小修法及需要作者决定的事项。优先修会改变情节因果或暴露秘密的问题；修正一处后列出需要连带检查的后文。不要把所有意外都改成平直解释。

## 伏笔与回收核对
对照大纲检查线索是否真的写入正文、回收是否依赖未曾出现的信息、仍悬而未决的内容是否属于有意保留。修订可能改变读者何时知道答案，因此同时检查悬念和角色认知。记录本轮已复核与尚未复核的章节，不以问题清单为空代表整部作品没有错误。

## 填写示例
原创虚构检查示例：第二章写阿禾尚未见到借条，第三章开头却说“她知道姐姐拿走了通行牌”。判为知识获得过程缺失。可在两处之间加入她发现借条的场景，或把后句改为“她猜姐姐也许见过通行牌”。两种修法对证据强度与后续对质不同，需选定后复查第四章，而不是同时保留。

## 完成检查
- [ ] 检查版本与章节范围明确，无法核对的材料已列出。
- [ ] 时间、行程、物品、知识和世界规则均有具体对照位置。
- [ ] 明确冲突与有意叙述安排分开，建议没有擅自改动作者意图。
- [ ] 已采用修法检查过受影响后文，未解决项有下一步。

## 文档衔接
把问题位置、证据和选定修法交回“章节写作”；若修法改变正式设定，同步“世界观设定”“角色设定”或“故事大纲”。向“风格编辑”提供修订后的正文与仍不可改动的事实边界，避免润色再次引入矛盾。`,
    en: `## Before you start
Find conflicts in time, place, knowledge, possessions, and world rules, then propose locatable repairs. Gather one consistent version of “Write chapters,” plus “World bible,” “Character bible,” and “Story outline.” Record coverage first. Mark missing chapters as unavailable instead of inferring facts from summaries. Assess intentional misunderstandings, flashbacks, and unreliable narration against the book's established narrative choices.

## Timeline and scene locations
Order events by when they actually occur, then note their order of presentation. Record dates or relative times, duration, locations, travel, and communication delays. Can characters arrive in time? Do injuries change through an established process? Can simultaneous scenes coexist? Use ranges when timing is uncertain rather than inventing exact times.

## State and information tracking
| Object or thread | Earlier established state and location | Later state and location | Evidence of change | Finding |
| --- | --- | --- | --- | --- |
| [Knowledge/possession/injury/rule] | [Chapter, paragraph] | [Chapter, paragraph] | [Transfer, discovery, or change event] | [Consistent/question/conflict] |
For possessions, check holder, quantity, and destination. For secrets, check who learned what, when, and how. For rules, check conditions, costs, and exceptions. Point to specific passages instead of merely saying the story is inconsistent.

## Classify problems and propose repairs
Separate explicit contradictions, missing explanations, possible intentional setups, and stylistic preferences. For each issue, record impact, evidence, at least one minimal repair, and any author decision needed. Prioritize problems that alter causality or reveal secrets. List later passages affected by each repair. Do not flatten every surprise into an explanation.

## Setups and payoffs
Compare the outline with actual prose: was the setup written, does the payoff require information never introduced, and are unresolved threads intentional? Repairs can change when readers know the answer, so review suspense alongside character knowledge. Record checked and unchecked chapters. An empty issue list does not establish that an entire novel is error-free.

## Worked example
Original fictional check: chapter two says Ahe has not seen the note, but chapter three opens, “She knew her sister had taken the pass.” Classify this as missing knowledge acquisition. Insert a discovery between those moments, or change the sentence to “She wondered whether her sister had seen the pass.” These repairs imply different certainty and affect a later confrontation. Choose one and recheck chapter four instead of retaining both.

## Completion checklist
- [ ] Version, chapter coverage, and unavailable material are explicit.
- [ ] Time, travel, possessions, knowledge, and rules have passage-level comparisons.
- [ ] Contradictions are separate from intentional narration; repairs respect author intent.
- [ ] Adopted repairs were checked downstream and open issues have next actions.

## Related documents
Return locations, evidence, and selected repairs to “Write chapters.” If a repair changes established facts, update “World bible,” “Character bible,” or “Story outline.” Give “Style edit” the repaired manuscript and remaining factual boundaries so polishing does not introduce new contradictions.`,
  },
  'style-edit': {
    zh: `## 填写前
本页在保留情节事实和人物声音的前提下调整语言、节奏与阅读感受。准备最新“章节写作”“连续性检查”及“角色设定”中的声音示例。先选一小段试改，写清希望更紧张、疏离、温暖或其他具体效果。尚未解决的连续性问题保留标记，不用漂亮句子掩盖。

## 本书风格约定
填写类型、目标读者、叙述视角、时态、叙述距离和允许的语言浓度。选择几段本书已有且希望保持的文字，说明喜欢的是句长、观察角度、幽默方式还是留白。方言、抒情、内心独白与碎句均按作品意图决定；“少用形容词”之类只能是当前稿件的策略，不能当作通用禁令。

## 段落诊断与改写表
| 原文位置与摘录 | 具体阅读问题 | 建议改写 | 希望产生的效果 | 必须保留的事实或声音 |
| --- | --- | --- | --- | --- |
| [章节、段落与短摘录] | [重复/指代不清/节奏等] | [填写] | [填写] | [填写] |
先说明问题再动笔。朗读对话检查人物是否都像同一个人；检查修辞是否来自当前视角能注意到的事物。删除重复解释时，确认仍保留理解选择所需的信息。

## 节奏与叙述距离
标记场景中行动、感知、思考和说明的分布。紧张段落是否被无关背景打断？需要停顿的地方是否过快？按目标效果试调句子长度、段落切分和信息顺序；不机械规定短句等于紧张。保持叙述距离的变化有理由，并检查是否突然越过角色知识边界。

## 改写取舍与版本记录
给关键段落保留原文及一到两个方案，说明语气、速度和信息量的差别，由作者选择适合本书的一版。记录采用范围和版本日期。改写涉及动作顺序、物品、时间或秘密时，回查连续性；不要为了押韵或形象化而新增会改变情节的事实。

## 完整修订正文
本页是风格编辑后的完整小说稿输出。将已采用的润色写入全部确认章节，按故事阅读顺序在此汇总整稿，不只保留改写表或局部片段。填写整稿版本、日期、源稿版本、采用章节范围及关键方案：[填写]。未修改的章节也完整收入；若某章尚缺失，明确列为待补，不把局部润色称为全稿完成。

### 作品题名与采用版本
[填写题名、整稿版本和已采用的章节清单；创作备注放在正文之外。]

### [填写第一章或已确认开篇标题]
[填写本章完整修订正文，包含所有场景与转场，而非仅有修改的句子。]

### [填写下一章标题]
[填写下一章完整修订正文，逐章重复至已确认结尾；按作品需要保留序章、尾声等部分。]

整稿应可从开篇连续读到结尾，叙述顺序、角色声音与已确认事实保持一致。版本说明和修改记录单独保留，避免读者把编辑意见当成故事内容。

## 填写示例
原创虚构示例，目标为克制的近距离叙述。原句：“阿禾感到非常焦虑，非常害怕船会离开。”试改：“跳板离岸。阿禾攥住空衣袋，没再开口。”改写用动作压缩情绪说明，但增加了“攥衣袋”的动作；采用前确认人物确有衣袋且通行牌缺失已成立。若目标是外放幽默，可另写方案，不必沿用克制风格。

## 完成检查
- [ ] 风格目标具体，类型、视角及角色声音有明确参照。
- [ ] 主要改写能说明阅读收益，且没有把所有人物改成同一种声音。
- [ ] 语言调整保留必要信息，没有偷偷改变时间、知识或物品状态。
- [ ] 采用版本清楚，新增动作已核对，未解决问题仍可见。
- [ ] 本页已收齐确认范围内从开篇到结尾的完整修订正文，章节及场景无遗漏，正文占位已替换，影响交付的未决问题已解决。

## 文档衔接
本页“完整修订正文”承接风格编辑的最终整稿输出；保留“章节写作”的源稿供对照，并记录从源稿采用哪些章节与修改，不以只交回修改意见代替完整稿。将可能影响事实的改动交给“连续性检查”复核，采用修正后更新本页整稿。稳定形成的新声音特征补入“角色设定”；若润色改变场景功能或事件顺序，则同步“故事大纲”。最终保留本页完整正文、版本说明与改写记录。`,
    en: `## Before you start
Adjust language, rhythm, and reading experience while preserving plot facts and distinct voices. Gather the latest “Write chapters,” “Continuity check,” and voice samples from “Character bible.” Begin with a short trial passage and specify a desired effect such as tension, distance, or warmth. Keep unresolved continuity issues visible rather than disguising them with attractive sentences.

## Style choices for this book
Enter genre, audience, viewpoint, tense, narrative distance, and preferred language density. Select existing passages worth retaining and explain whether their sentence rhythm, observation, humor, or restraint is the reference. Dialect, lyricism, interior monologue, and fragments depend on the work's intention. Advice such as reducing adjectives is a strategy for a particular passage, not a universal prohibition.

## Passage diagnosis and revision
| Location and excerpt | Specific reading problem | Proposed revision | Intended effect | Facts or voice to preserve |
| --- | --- | --- | --- | --- |
| [Chapter, paragraph, short excerpt] | [Repetition/reference/rhythm/etc.] | [Enter] | [Enter] | [Enter] |
Name the problem before changing the wording. Read dialogue aloud to check whether everyone sounds alike. Are images drawn from things the current viewpoint would notice? When removing repeated explanation, preserve information needed to understand choices.

## Rhythm and narrative distance
Mark the distribution of action, perception, thought, and exposition. Does unrelated background interrupt a tense passage? Does a moment needing reflection pass too quickly? Experiment with sentence length, paragraph breaks, and information order against the intended effect. Short sentences do not automatically create tension. Give shifts in narrative distance a reason and check for accidental access to knowledge outside the viewpoint.

## Alternatives and version decisions
For important passages, retain the original and one or two alternatives. Explain differences in tone, speed, and information, then select the version suited to the book. Record adoption scope and version date. If a revision changes actions, possessions, timing, or secrets, recheck continuity. Do not introduce plot-altering facts solely for a vivid image or pleasing sound.

## Complete revised manuscript
This page is the complete novel manuscript output after style editing. Apply adopted revisions across all agreed chapters and assemble the whole manuscript here in reading order, not merely a revision table or selected excerpts. Enter manuscript version, date, source version, included chapters, and major adopted alternatives: [Enter]. Include unchanged chapters in full. Identify missing chapters as pending; partial polishing is not completion of the full manuscript.

### Work title and adopted version
[Enter the title, manuscript version, and list of included chapters. Keep creative notes outside the narrative.]

### [Enter first chapter or agreed opening title]
[Insert the complete revised chapter, including all scenes and transitions rather than only changed sentences.]

### [Enter next chapter title]
[Insert the next complete revised chapter. Repeat through the agreed ending, including a prologue or epilogue if the work uses them.]

The assembled prose should read continuously from opening to ending, with coherent narrative order, character voices, and established facts. Keep version notes and revision records separate so editorial comments are not mistaken for story content.

## Worked example
Original fictional example aimed at restrained, close narration. Original: “Ahe felt extremely anxious and terribly afraid the boat would leave.” Trial: “The gangplank left the quay. Ahe clenched her empty pocket and said nothing.” The revision replaces explanation with action, but introduces the pocket-clenching action. Before adopting it, confirm that the clothing and missing pass are established. For an exuberantly comic voice, try a different version; restraint is not mandatory.

## Completion checklist
- [ ] The style target is specific, with genre, viewpoint, and character-voice references.
- [ ] Major edits have a stated benefit and do not make all characters sound alike.
- [ ] Revisions retain necessary information and do not silently alter time, knowledge, or possessions.
- [ ] The adopted version is clear; new actions were checked and unresolved issues remain visible.
- [ ] This page contains complete revised prose from the agreed opening through the ending, with no missing chapters or scenes, manuscript placeholders replaced, and delivery-blocking issues resolved.

## Related documents
The “Complete revised manuscript” area on this page is the final complete output of style editing. Preserve the source in “Write chapters” for comparison and identify the chapters and edits adopted from it; returning comments alone does not replace the complete manuscript. Send fact-affecting revisions to “Continuity check,” then incorporate accepted corrections into the manuscript here. Add stable new voice choices to “Character bible.” If editing changes scene function or event order, update “Story outline.” Retain the complete prose on this page, version notes, and revision record.`,
  },
};
