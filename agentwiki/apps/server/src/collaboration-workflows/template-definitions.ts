import {
  CollaborationTemplateDefinitionSchema,
  type CollaborationNode,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';

type AgentTaskNode = Extract<CollaborationNode, { kind: 'agent_task' }>;
type HumanReviewNode = Extract<CollaborationNode, { kind: 'human_review' }>;
type BilingualText = Readonly<{ zh: string; en: string }>;

export type BuiltInCollaborationTemplate = Readonly<{
  slug: string;
  name: BilingualText;
  description: BilingualText;
  seedVersion: number;
  definition: CollaborationTemplateDefinition;
}>;

const todo = (
  id: string,
  name: string,
  evidenceKinds: string[] = [],
  required = true,
): AgentTaskNode['todos'][number] => ({ id, name, required, evidenceKinds });

const task = (options: {
  id: string;
  name: string;
  roleSlotId: string;
  objective: string;
  outputKey: string;
  inputKeys?: string[];
  upstreamArtifacts?: AgentTaskNode['upstreamArtifacts'];
  evidenceRequired?: string[];
  humanAcceptance?: boolean;
  todos?: AgentTaskNode['todos'];
  outputKind?: AgentTaskNode['output']['kind'];
  skippable?: boolean;
}): AgentTaskNode => ({
  kind: 'agent_task',
  id: options.id,
  name: options.name,
  roleSlotId: options.roleSlotId,
  objective: options.objective,
  inputKeys: options.inputKeys ?? [],
  upstreamArtifacts: options.upstreamArtifacts ?? [],
  output: { key: options.outputKey, kind: options.outputKind ?? 'markdown' },
  evidenceRequired: options.evidenceRequired ?? [],
  humanAcceptance: options.humanAcceptance ?? false,
  leaseSeconds: 600,
  maxExecutionSeconds: 14_400,
  retryBudget: 2,
  repairBudget: 2,
  skippable: options.skippable ?? false,
  todos: options.todos ?? [todo('complete', `Complete ${options.name}`)],
});

const review = (options: {
  id: string;
  name: string;
  artifactTaskId: string;
  revisionTaskId?: string;
  criteria: string[];
  allowTerminate?: boolean;
}): HumanReviewNode => ({
  kind: 'human_review',
  id: options.id,
  name: options.name,
  artifactTaskId: options.artifactTaskId,
  minimumRole: 'editor',
  reviewerUserIds: [],
  approvalCriteria: options.criteria,
  revisionTaskId: options.revisionTaskId ?? options.artifactTaskId,
  allowTerminate: options.allowTerminate ?? true,
});

const roleSlots = (items: readonly [string, string][]) => items.map(([id, name]) => ({
  id,
  name,
  required: true,
  description: name,
}));

const edge = (from: string, to: string) => ({ from, to, mode: 'all' as const });
const artifact = (key: string, required = true) => ({ key, required });

function defineSeed(seed: Omit<BuiltInCollaborationTemplate, 'definition'> & { definition: unknown }): BuiltInCollaborationTemplate {
  const definition = CollaborationTemplateDefinitionSchema.parse(structuredClone(seed.definition));
  return deepFreeze({ ...seed, definition });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const codingTemplate = defineSeed({
  slug: 'coding',
  name: { zh: '编码协作', en: 'Coding collaboration' },
  description: { zh: '从需求分析到合并发布审阅的并行编码工作流', en: 'Parallel coding workflow from requirements to merge/release review' },
  seedVersion: 1,
  definition: {
    schemaVersion: 1,
    inputs: [
      { key: 'project-brief', label: '项目目标 / Project brief', required: true, type: 'long_text' },
      { key: 'repository-reference', label: '仓库引用 / Repository reference', required: false, type: 'short_text' },
    ],
    roleSlots: roleSlots([
      ['planner', '规划者 / Planner'],
      ['implementer-a', '实现者 A / Implementer A'],
      ['implementer-b', '实现者 B / Implementer B'],
      ['tester', '测试者 / Tester'],
      ['code-reviewer', '代码审校者 / Code reviewer'],
      ['release-owner', '发布负责人 / Release owner'],
    ]),
    nodes: [
      task({
        id: 'requirements-analysis', name: '需求分析 / Requirements analysis', roleSlotId: 'planner',
        objective: 'Analyze scope, constraints, acceptance criteria, and repository boundaries without mutating the repository.',
        outputKey: 'plan', inputKeys: ['project-brief', 'repository-reference'],
        todos: [todo('clarify-scope', 'Clarify scope'), todo('define-acceptance', 'Define acceptance criteria')],
      }),
      task({
        id: 'implementation-plan', name: '实施计划 / Implementation plan', roleSlotId: 'planner',
        objective: 'Turn the accepted requirements analysis into a test-first, conflict-aware implementation plan.',
        outputKey: 'test-plan', upstreamArtifacts: [artifact('plan')],
        todos: [todo('split-work', 'Split independent work'), todo('plan-tests', 'Plan tests and integration')],
      }),
      task({
        id: 'implement-module-a', name: '实现模块 A / Implement module A', roleSlotId: 'implementer-a',
        objective: 'Implement module A in the assigned external workspace and return an auditable commit or patch reference.',
        outputKey: 'patch-a', upstreamArtifacts: [artifact('test-plan')], evidenceRequired: ['commit-or-patch'],
        todos: [todo('write-tests', 'Write failing tests'), todo('implement', 'Implement module A', ['commit-or-patch'])],
      }),
      task({
        id: 'implement-module-b', name: '实现模块 B / Implement module B', roleSlotId: 'implementer-b',
        objective: 'Implement module B in the assigned external workspace and return an auditable commit or patch reference.',
        outputKey: 'patch-b', upstreamArtifacts: [artifact('test-plan')], evidenceRequired: ['commit-or-patch'],
        todos: [todo('write-tests', 'Write failing tests'), todo('implement', 'Implement module B', ['commit-or-patch'])],
      }),
      task({
        id: 'run-tests', name: '运行测试 / Run tests', roleSlotId: 'tester',
        objective: 'Run focused and integration tests against both proposed patches and report reproducible evidence.',
        outputKey: 'test-evidence', upstreamArtifacts: [artifact('patch-a'), artifact('patch-b')], evidenceRequired: ['test-evidence'],
        todos: [todo('focused-tests', 'Run focused tests', ['test-evidence']), todo('integration-tests', 'Run integration tests', ['test-evidence'])],
      }),
      task({
        id: 'agent-code-review', name: 'Agent 代码审校 / Agent code review', roleSlotId: 'code-reviewer',
        objective: 'Review both proposed patches for correctness, security, maintainability, and integration risk.',
        outputKey: 'review-report', upstreamArtifacts: [artifact('patch-a'), artifact('patch-b')],
        todos: [todo('review-correctness', 'Review correctness'), todo('review-risk', 'Review security and integration risk')],
      }),
      task({
        id: 'fix-defects', name: '修复缺陷 / Fix defects', roleSlotId: 'implementer-a',
        objective: 'Resolve all actionable test and review findings in the external workspace and return a revised patch reference.',
        outputKey: 'fixed-patch', upstreamArtifacts: [artifact('test-evidence'), artifact('review-report')], evidenceRequired: ['commit-or-patch'],
        todos: [todo('resolve-findings', 'Resolve findings', ['commit-or-patch']), todo('recheck', 'Recheck repaired behavior')],
      }),
      task({
        id: 'release-summary', name: '发布摘要 / Release summary', roleSlotId: 'release-owner',
        objective: 'Prepare release notes, residual risks, evidence links, and a human merge decision package; do not publish or mutate a repository.',
        outputKey: 'release-notes', upstreamArtifacts: [artifact('fixed-patch')], humanAcceptance: true,
        todos: [todo('summarize-changes', 'Summarize changes'), todo('collect-evidence', 'Collect evidence and residual risks')],
      }),
      review({
        id: 'merge-release-review', name: '合并发布审阅 / Merge and release review', artifactTaskId: 'release-summary',
        criteria: ['Evidence is complete', 'Residual risks are explicit', 'A human accepts the merge/release decision'],
      }),
    ],
    dependencies: [
      edge('requirements-analysis', 'implementation-plan'),
      edge('implementation-plan', 'implement-module-a'), edge('implementation-plan', 'implement-module-b'),
      edge('implement-module-a', 'run-tests'), edge('implement-module-b', 'run-tests'),
      edge('implement-module-a', 'agent-code-review'), edge('implement-module-b', 'agent-code-review'),
      edge('run-tests', 'fix-defects'), edge('agent-code-review', 'fix-defects'),
      edge('fix-defects', 'release-summary'), edge('release-summary', 'merge-release-review'),
    ],
    terminalNodeIds: ['merge-release-review'],
  },
});

const bidWritingTemplate = defineSeed({
  slug: 'bid-writing',
  name: { zh: '标书撰写协作', en: 'Bid writing collaboration' },
  description: { zh: '覆盖招标分析、材料盘点、分章撰写与人工终审', en: 'Tender analysis, material inventory, parallel drafting, and human final review' },
  seedVersion: 1,
  definition: {
    schemaVersion: 1,
    inputs: [
      { key: 'tender-brief', label: '招标要求 / Tender brief', required: true, type: 'long_text' },
      { key: 'available-materials', label: '已有材料 / Available materials', required: false, type: 'long_text' },
    ],
    roleSlots: roleSlots([
      ['tender-analyst', '招标分析员 / Tender analyst'], ['material-manager', '材料管理员 / Material manager'],
      ['solution-architect', '方案架构师 / Solution architect'], ['section-writer-a', '章节作者 A / Section writer A'],
      ['section-writer-b', '章节作者 B / Section writer B'], ['compliance-reviewer', '合规审校员 / Compliance reviewer'],
      ['final-editor', '终稿编辑 / Final editor'],
    ]),
    nodes: [
      task({
        id: 'tender-analysis', name: '招标分析 / Tender analysis', roleSlotId: 'tender-analyst',
        objective: 'Extract scoring rules, mandatory responses, exclusions, deadlines, and evidence obligations.',
        outputKey: 'scoring-matrix', inputKeys: ['tender-brief'], humanAcceptance: true,
        todos: [todo('extract-scoring', 'Extract scoring matrix'), todo('identify-hard-gates', 'Identify mandatory gates')],
      }),
      task({
        id: 'material-catalog', name: '材料盘点 / Material catalog', roleSlotId: 'material-manager',
        objective: 'Catalog available evidence, qualifications, diagrams, and missing source materials without inventing facts.',
        outputKey: 'material-index', inputKeys: ['available-materials'],
        todos: [todo('catalog-materials', 'Catalog supplied materials'), todo('mark-gaps', 'Mark missing or unverifiable materials')],
      }),
      review({
        id: 'bid-consensus-review', name: '投标共识审阅 / Bid consensus review', artifactTaskId: 'tender-analysis',
        criteria: ['Scoring matrix is complete', 'Material gaps are understood', 'Human confirms bid direction'],
      }),
      task({
        id: 'outline-and-mapping', name: '大纲与映射 / Outline and mapping', roleSlotId: 'solution-architect',
        objective: 'Map every scoring item and mandatory response to an owned section, evidence source, and visual plan.',
        outputKey: 'outline', upstreamArtifacts: [artifact('scoring-matrix'), artifact('material-index')],
        todos: [todo('map-scoring', 'Map scoring items'), todo('map-evidence', 'Map evidence and image-text relationships')],
      }),
      task({
        id: 'write-technical-sections', name: '技术章节撰写 / Technical section writing', roleSlotId: 'section-writer-a',
        objective: 'Draft the technical response against the approved outline and evidence map; flag unsupported claims.',
        outputKey: 'technical-draft', upstreamArtifacts: [artifact('outline')], humanAcceptance: true,
        todos: [todo('write-solution', 'Write technical solution'), todo('link-evidence', 'Link technical evidence')],
      }),
      task({
        id: 'write-service-sections', name: '服务章节撰写 / Service section writing', roleSlotId: 'section-writer-b',
        objective: 'Draft delivery, support, training, quality, and service commitments against the approved outline.',
        outputKey: 'service-draft', upstreamArtifacts: [artifact('outline')],
        todos: [todo('write-delivery', 'Write delivery and support'), todo('check-commitments', 'Check commitments against materials')],
      }),
      review({
        id: 'missing-material-review', name: '缺失材料审阅 / Missing material review', artifactTaskId: 'write-technical-sections',
        criteria: ['Unsupported claims are listed', 'Missing evidence has an owner', 'Human decides how to handle gaps'],
      }),
      task({
        id: 'coverage-and-visual-check', name: '覆盖与图文检查 / Coverage and visual check', roleSlotId: 'compliance-reviewer',
        objective: 'Check scoring coverage, outline mapping, image-text mapping, compliance, and consistency across both drafts.',
        outputKey: 'coverage-report', upstreamArtifacts: [artifact('technical-draft'), artifact('service-draft')],
        todos: [
          todo('check-coverage', 'Check scoring and mandatory coverage'),
          todo('check-outline-mapping', 'Check outline mapping'),
          todo('check-image-text', 'Check image-text mapping'),
          todo('check-consistency', 'Check cross-draft consistency'),
        ],
      }),
      task({
        id: 'merge-and-polish', name: '合并与润色 / Merge and polish', roleSlotId: 'final-editor',
        objective: 'Merge the two drafts, resolve the coverage report, normalize terminology, and prepare a coherent final Markdown draft.',
        outputKey: 'merged-bid', upstreamArtifacts: [artifact('technical-draft'), artifact('service-draft'), artifact('coverage-report')], humanAcceptance: true,
        todos: [todo('merge-drafts', 'Merge drafts'), todo('resolve-coverage', 'Resolve coverage findings'), todo('polish', 'Polish terminology and flow')],
      }),
      review({
        id: 'final-bid-review', name: '标书终审 / Final bid review', artifactTaskId: 'merge-and-polish',
        criteria: ['All mandatory items are covered', 'Claims are evidence-backed', 'Human accepts the final bid content'],
      }),
      task({
        id: 'export-reference', name: '导出引用 / Export reference', roleSlotId: 'final-editor',
        objective: 'Return an auditable external export reference and content hash only; do not upload or claim to generate DOCX or PDF in AgentWiki.',
        outputKey: 'export-manifest', outputKind: 'external_reference', upstreamArtifacts: [artifact('merged-bid')],
        todos: [todo('prepare-reference', 'Prepare the external export reference'), todo('record-hash', 'Record version and content hash')],
      }),
    ],
    dependencies: [
      edge('tender-analysis', 'bid-consensus-review'),
      edge('material-catalog', 'bid-consensus-review'),
      edge('bid-consensus-review', 'outline-and-mapping'),
      edge('outline-and-mapping', 'write-technical-sections'), edge('outline-and-mapping', 'write-service-sections'),
      edge('write-technical-sections', 'missing-material-review'),
      edge('missing-material-review', 'coverage-and-visual-check'), edge('write-service-sections', 'coverage-and-visual-check'),
      edge('coverage-and-visual-check', 'merge-and-polish'),
      edge('merge-and-polish', 'final-bid-review'), edge('final-bid-review', 'export-reference'),
    ],
    terminalNodeIds: ['export-reference'],
  },
});

const paperWritingTemplate = defineSeed({
  slug: 'paper-writing',
  name: { zh: '论文撰写协作', en: 'Paper writing collaboration' },
  description: { zh: '研究范围、文献方法并行、引文核验和学术终审', en: 'Research scope, parallel literature and methods, citation verification, and academic review' },
  seedVersion: 1,
  definition: {
    schemaVersion: 1,
    inputs: [
      { key: 'research-question', label: '研究问题 / Research question', required: true, type: 'long_text' },
      { key: 'source-boundary', label: '资料边界 / Source boundary', required: false, type: 'long_text' },
    ],
    roleSlots: roleSlots([
      ['research-planner', '研究规划者 / Research planner'], ['literature-researcher', '文献研究者 / Literature researcher'],
      ['method-analyst', '方法分析者 / Method analyst'], ['chapter-author', '章节作者 / Chapter author'],
      ['citation-verifier', '引文核验者 / Citation verifier'], ['academic-editor', '学术编辑 / Academic editor'],
    ]),
    nodes: [
      task({
        id: 'research-scope', name: '研究范围 / Research scope', roleSlotId: 'research-planner',
        objective: 'Define the research question, contribution, evidence boundary, section plan, and claims that require verification.',
        outputKey: 'research-outline', inputKeys: ['research-question', 'source-boundary'], humanAcceptance: true,
        todos: [todo('define-question', 'Define question and contribution'), todo('define-evidence-boundary', 'Define evidence boundary')],
      }),
      review({
        id: 'outline-review', name: '大纲审阅 / Outline review', artifactTaskId: 'research-scope',
        criteria: ['Research question is answerable', 'Contribution is explicit', 'Evidence boundary is acceptable'],
      }),
      task({
        id: 'literature-review', name: '文献综述 / Literature review', roleSlotId: 'literature-researcher',
        objective: 'Build a source-identified literature map, record provenance, and separate verified sources from leads.',
        outputKey: 'source-list', upstreamArtifacts: [artifact('research-outline')], evidenceRequired: ['source-identifiers'],
        todos: [todo('collect-sources', 'Collect source identifiers', ['source-identifiers']), todo('synthesize-literature', 'Synthesize literature themes')],
      }),
      task({
        id: 'method-analysis', name: '方法分析 / Method analysis', roleSlotId: 'method-analyst',
        objective: 'Specify the method, assumptions, data needs, limitations, and validity checks for the approved scope.',
        outputKey: 'method-note', upstreamArtifacts: [artifact('research-outline')],
        todos: [todo('define-method', 'Define method'), todo('record-limitations', 'Record assumptions and limitations')],
      }),
      task({
        id: 'draft-chapters', name: '章节起草 / Draft chapters', roleSlotId: 'chapter-author',
        objective: 'Draft coherent chapters using only declared sources and the method note, marking every claim that still needs verification.',
        outputKey: 'chapter-draft', upstreamArtifacts: [artifact('source-list'), artifact('method-note')],
        todos: [todo('draft-sections', 'Draft sections'), todo('mark-claims', 'Mark claims requiring citations')],
      }),
      task({
        id: 'verify-citations', name: '引文核验 / Verify citations', roleSlotId: 'citation-verifier',
        objective: 'Verify source identifiers, claim-to-source support, quotation accuracy, and explicitly mark unverifiable claims.',
        outputKey: 'citation-report', upstreamArtifacts: [artifact('chapter-draft'), artifact('source-list')],
        evidenceRequired: ['source-verification'],
        todos: [
          todo('verify-identifiers', 'Verify source identifiers', ['source-verification']),
          todo('verify-claims', 'Verify claim support', ['source-verification']),
          todo('mark-unverifiable', 'Mark unverifiable claims'),
        ],
      }),
      task({
        id: 'academic-edit', name: '学术编辑 / Academic edit', roleSlotId: 'academic-editor',
        objective: 'Resolve citation findings, improve argument structure and academic style, and preserve explicit uncertainty.',
        outputKey: 'final-markdown', upstreamArtifacts: [artifact('chapter-draft'), artifact('citation-report')], humanAcceptance: true,
        todos: [todo('resolve-citations', 'Resolve citation findings'), todo('edit-argument', 'Edit argument and style')],
      }),
      review({
        id: 'paper-final-review', name: '论文终审 / Paper final review', artifactTaskId: 'academic-edit',
        criteria: ['Claims are traceable', 'Limitations are explicit', 'Human accepts the final academic content'],
      }),
      task({
        id: 'paper-export-reference', name: '论文导出引用 / Paper export reference', roleSlotId: 'academic-editor',
        objective: 'Return an auditable external manuscript or LaTeX export reference and content hash only.',
        outputKey: 'export-manifest', outputKind: 'external_reference', upstreamArtifacts: [artifact('final-markdown')],
        todos: [todo('prepare-reference', 'Prepare export reference'), todo('record-hash', 'Record version and content hash')],
      }),
    ],
    dependencies: [
      edge('research-scope', 'outline-review'),
      edge('outline-review', 'literature-review'), edge('outline-review', 'method-analysis'),
      edge('literature-review', 'draft-chapters'), edge('method-analysis', 'draft-chapters'),
      edge('draft-chapters', 'verify-citations'),
      edge('verify-citations', 'academic-edit'),
      edge('academic-edit', 'paper-final-review'), edge('paper-final-review', 'paper-export-reference'),
    ],
    terminalNodeIds: ['paper-export-reference'],
  },
});

const videoScriptWritingTemplate = defineSeed({
  slug: 'video-script-writing',
  name: { zh: '视频脚本撰写协作', en: 'Video script writing collaboration' },
  description: { zh: '事实研究、旁白分镜并行和制片前人工审阅', en: 'Fact research, parallel voiceover and storyboard, and pre-production review' },
  seedVersion: 1,
  definition: {
    schemaVersion: 1,
    inputs: [
      { key: 'video-goal', label: '视频目标 / Video goal', required: true, type: 'long_text' },
      { key: 'target-duration-seconds', label: '目标时长秒数 / Target duration seconds', required: true, type: 'number' },
      { key: 'brand-guidance', label: '品牌语调 / Brand guidance', required: false, type: 'long_text' },
    ],
    roleSlots: roleSlots([
      ['content-planner', '内容策划 / Content planner'], ['fact-researcher', '事实研究者 / Fact researcher'],
      ['script-writer', '脚本作者 / Script writer'], ['storyboard-designer', '分镜设计者 / Storyboard designer'],
      ['brand-fact-reviewer', '品牌事实审校者 / Brand and fact reviewer'],
    ]),
    nodes: [
      task({
        id: 'creative-brief', name: '创意简报 / Creative brief', roleSlotId: 'content-planner',
        objective: 'Define the audience, promise, format, target duration, brand boundary, and call to action.',
        outputKey: 'brief', inputKeys: ['video-goal', 'target-duration-seconds', 'brand-guidance'],
        todos: [todo('define-audience', 'Define audience and promise'), todo('define-duration', 'Define duration and format')],
      }),
      task({
        id: 'fact-research', name: '事实研究 / Fact research', roleSlotId: 'fact-researcher',
        objective: 'Prepare source-linked fact cards and mark claims that cannot be verified.',
        outputKey: 'fact-cards', upstreamArtifacts: [artifact('brief')], evidenceRequired: ['source-verification'],
        todos: [todo('collect-facts', 'Collect fact cards', ['source-verification']), todo('mark-uncertainty', 'Mark uncertain claims')],
      }),
      task({
        id: 'hook-and-structure', name: '开场与结构 / Hook and structure', roleSlotId: 'content-planner',
        objective: 'Design the hook, beat structure, timing budget, and call to action using verified fact cards.',
        outputKey: 'structure', upstreamArtifacts: [artifact('brief'), artifact('fact-cards')],
        todos: [todo('design-hook', 'Design hook'), todo('budget-timing', 'Budget timing by beat')],
      }),
      task({
        id: 'write-voiceover', name: '旁白撰写 / Write voiceover', roleSlotId: 'script-writer',
        objective: 'Write timed voiceover with explicit fact-card references and production cues.',
        outputKey: 'voiceover', upstreamArtifacts: [artifact('structure'), artifact('fact-cards')],
        todos: [todo('write-voiceover', 'Write voiceover'), todo('estimate-duration', 'Estimate spoken duration')],
      }),
      task({
        id: 'design-storyboard', name: '分镜设计 / Design storyboard', roleSlotId: 'storyboard-designer',
        objective: 'Design shot-by-shot visual, text, transition, and asset-reference guidance for each structure beat.',
        outputKey: 'storyboard', upstreamArtifacts: [artifact('structure')],
        todos: [todo('map-shots', 'Map shots to beats'), todo('map-assets', 'Map text and asset references')],
      }),
      task({
        id: 'duration-fact-brand-check', name: '时长事实品牌检查 / Duration, fact, and brand check', roleSlotId: 'brand-fact-reviewer',
        objective: 'Check duration, facts, brand tone, voiceover-storyboard alignment, and unsupported asset claims.',
        outputKey: 'review-report', upstreamArtifacts: [artifact('voiceover'), artifact('storyboard'), artifact('fact-cards')],
        todos: [
          todo('check-duration', 'Check duration'), todo('verify-facts', 'Verify facts', ['source-verification']),
          todo('check-brand-tone', 'Check brand tone'), todo('check-alignment', 'Check voiceover and storyboard alignment'),
        ],
      }),
      task({
        id: 'final-script', name: '最终脚本 / Final script', roleSlotId: 'script-writer',
        objective: 'Resolve the review report and merge the accepted voiceover and storyboard into a production-ready Markdown script.',
        outputKey: 'final-script', upstreamArtifacts: [artifact('voiceover'), artifact('storyboard'), artifact('review-report')], humanAcceptance: true,
        todos: [todo('resolve-review', 'Resolve review findings'), todo('merge-script', 'Merge final production script')],
      }),
      review({
        id: 'pre-production-review', name: '制片前审阅 / Pre-production review', artifactTaskId: 'final-script',
        criteria: ['Duration is credible', 'Facts and brand tone are accepted', 'Human authorizes pre-production handoff'],
      }),
    ],
    dependencies: [
      edge('creative-brief', 'fact-research'), edge('fact-research', 'hook-and-structure'),
      edge('hook-and-structure', 'write-voiceover'), edge('hook-and-structure', 'design-storyboard'),
      edge('write-voiceover', 'duration-fact-brand-check'), edge('design-storyboard', 'duration-fact-brand-check'),
      edge('duration-fact-brand-check', 'final-script'), edge('final-script', 'pre-production-review'),
    ],
    terminalNodeIds: ['pre-production-review'],
  },
});

const novelWritingTemplate = defineSeed({
  slug: 'novel-writing',
  name: { zh: '小说撰写协作', en: 'Novel writing collaboration' },
  description: { zh: '世界观与角色并行、连续性约束写作和双阶段人工审阅', en: 'Parallel world and character design, continuity-aware drafting, and two human reviews' },
  seedVersion: 1,
  definition: {
    schemaVersion: 1,
    inputs: [
      { key: 'story-premise', label: '故事设定 / Story premise', required: true, type: 'long_text' },
      { key: 'style-guidance', label: '风格指导 / Style guidance', required: false, type: 'long_text' },
    ],
    roleSlots: roleSlots([
      ['world-builder', '世界构建者 / World builder'], ['plot-architect', '情节架构师 / Plot architect'],
      ['chapter-author', '章节作者 / Chapter author'], ['continuity-editor', '连续性编辑 / Continuity editor'],
      ['style-editor', '风格编辑 / Style editor'],
    ]),
    nodes: [
      task({
        id: 'world-bible', name: '世界观设定 / World bible', roleSlotId: 'world-builder',
        objective: 'Define setting rules, locations, factions, chronology, constraints, and unresolved world questions.',
        outputKey: 'world-bible', inputKeys: ['story-premise'],
        todos: [todo('define-rules', 'Define world rules'), todo('define-timeline', 'Define locations and chronology')],
      }),
      task({
        id: 'character-bible', name: '角色设定 / Character bible', roleSlotId: 'plot-architect',
        objective: 'Define character goals, conflicts, arcs, relationships, knowledge boundaries, and voice markers.',
        outputKey: 'character-bible', inputKeys: ['story-premise'],
        todos: [todo('define-arcs', 'Define character arcs'), todo('define-relationships', 'Define relationships and knowledge boundaries')],
      }),
      task({
        id: 'story-outline', name: '故事大纲 / Story outline', roleSlotId: 'plot-architect',
        objective: 'Build a scene-and-chapter outline that respects world rules, character arcs, causality, and planned continuity checkpoints.',
        outputKey: 'story-outline', upstreamArtifacts: [artifact('world-bible'), artifact('character-bible')], humanAcceptance: true,
        todos: [todo('plot-structure', 'Plan chapter and scene structure'), todo('plan-continuity', 'Plan continuity checkpoints')],
      }),
      review({
        id: 'outline-review', name: '大纲审阅 / Outline review', artifactTaskId: 'story-outline',
        criteria: ['Causality is coherent', 'Character arcs and world rules align', 'Human accepts the planned story direction'],
      }),
      task({
        id: 'write-chapters', name: '章节写作 / Write chapters', roleSlotId: 'chapter-author',
        objective: 'Write chapters sequentially with explicit continuity dependencies between prior accepted scenes, character state, and world chronology.',
        outputKey: 'chapter-drafts', inputKeys: ['style-guidance'],
        upstreamArtifacts: [artifact('story-outline'), artifact('world-bible'), artifact('character-bible')],
        todos: [todo('write-sequentially', 'Write chapters sequentially'), todo('track-state', 'Track character and world state')],
      }),
      task({
        id: 'continuity-check', name: '连续性检查 / Continuity check', roleSlotId: 'continuity-editor',
        objective: 'Check chronology, character knowledge and motivation, locations, objects, unresolved threads, and world-rule consistency.',
        outputKey: 'continuity-report', upstreamArtifacts: [artifact('chapter-drafts'), artifact('world-bible'), artifact('character-bible')],
        todos: [todo('check-chronology', 'Check chronology and locations'), todo('check-character-state', 'Check character state'), todo('check-threads', 'Check unresolved threads')],
      }),
      task({
        id: 'style-edit', name: '风格编辑 / Style edit', roleSlotId: 'style-editor',
        objective: 'Resolve continuity findings and edit voice, rhythm, viewpoint, repetition, and chapter transitions without flattening character voices.',
        outputKey: 'full-manuscript', upstreamArtifacts: [artifact('chapter-drafts'), artifact('continuity-report')], humanAcceptance: true,
        todos: [todo('resolve-continuity', 'Resolve continuity findings'), todo('edit-style', 'Edit style and transitions')],
      }),
      review({
        id: 'novel-final-review', name: '小说终审 / Novel final review', artifactTaskId: 'style-edit',
        criteria: ['Continuity findings are resolved', 'Style and character voices are coherent', 'Human accepts the manuscript'],
      }),
    ],
    dependencies: [
      edge('world-bible', 'story-outline'), edge('character-bible', 'story-outline'),
      edge('story-outline', 'outline-review'), edge('outline-review', 'write-chapters'),
      edge('write-chapters', 'continuity-check'), edge('continuity-check', 'style-edit'),
      edge('style-edit', 'novel-final-review'),
    ],
    terminalNodeIds: ['novel-final-review'],
  },
});

export const BUILT_IN_COLLABORATION_TEMPLATES = Object.freeze([
  codingTemplate,
  bidWritingTemplate,
  paperWritingTemplate,
  videoScriptWritingTemplate,
  novelWritingTemplate,
] as const);
