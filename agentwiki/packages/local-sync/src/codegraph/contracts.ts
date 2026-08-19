import { z } from 'zod';

const SourceKeySchema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Shared strict schema for every path shown in a public scan-plan surface. */
export const PublicRelativeDisplayPathSchema = z.string().min(1).superRefine((path, context) => {
  if (/\p{Cc}/u.test(path)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Path must not contain control characters' });
  }
  if (path.startsWith('/') || /^[A-Za-z]:\//u.test(path)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Path must be relative' });
  }
  if (path.includes('\\')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Path must use forward slashes' });
  }
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Path must be normalized' });
  }
});

export const AnalysisModeSchema = z.enum(['standard', 'deep']);
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;

export const CodeGraphCapabilitiesSchema = z.object({
  required: z.object({
    'index.status': z.boolean(),
    'index.sync': z.boolean(),
    'files.list': z.boolean(),
  }).strict(),
  optional: z.object({
    'symbols.list': z.boolean(),
    'relations.read': z.boolean(),
    'semantic.explore': z.boolean(),
    'impact.read': z.boolean(),
    'routes.read': z.boolean(),
  }).strict(),
}).strict();
export type CodeGraphCapabilities = z.infer<typeof CodeGraphCapabilitiesSchema>;

export const CodeGraphSourcePlanSchema = z.object({
  sourceKey: SourceKeySchema,
  displayPath: z.string().min(1),
  canonicalSourcePath: z.string().min(1),
  indexPath: z.string().min(1),
  action: z.enum(['none', 'init', 'sync', 'rebuild']),
  indexState: z.enum(['missing', 'ready', 'stale', 'incomplete', 'failed']),
  estimatedFiles: z.number().int().nonnegative(),
}).strict();
export type CodeGraphSourcePlan = z.infer<typeof CodeGraphSourcePlanSchema>;

const UniqueSourcePlansSchema = z.array(CodeGraphSourcePlanSchema).min(1).superRefine((sources, context) => {
  const sourceKeys = new Set<string>();
  sources.forEach((source, index) => {
    if (sourceKeys.has(source.sourceKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate sourceKey',
        path: [index, 'sourceKey'],
      });
    }
    sourceKeys.add(source.sourceKey);
  });
});

export const LocalScanPlanSchema = z.object({
  schemaVersion: z.literal('agentwiki-local-scan-plan@1'),
  provider: z.literal('codegraph'),
  executableIdentity: z.string().min(1),
  detectedVersion: z.string().min(1),
  capabilities: CodeGraphCapabilitiesSchema,
  analysisMode: AnalysisModeSchema,
  sources: UniqueSourcePlansSchema,
  limits: z.object({
    maxFiles: z.number().int().positive(),
    maxGeneratedBytes: z.number().int().positive(),
  }).strict(),
  localScanPlanHash: SourceKeySchema,
}).strict();
export type LocalScanPlan = z.infer<typeof LocalScanPlanSchema>;

export const PublicCodeGraphSourcePlanSchema = CodeGraphSourcePlanSchema.pick({
  sourceKey: true,
  displayPath: true,
  action: true,
  indexState: true,
  estimatedFiles: true,
}).extend({
  displayPath: PublicRelativeDisplayPathSchema,
}).strict();

export const PublicLocalScanPlanSchema = LocalScanPlanSchema.pick({
  schemaVersion: true,
  provider: true,
  detectedVersion: true,
  capabilities: true,
  analysisMode: true,
  limits: true,
  localScanPlanHash: true,
}).extend({
  sources: z.array(PublicCodeGraphSourcePlanSchema),
}).strict();
export type PublicLocalScanPlan = z.infer<typeof PublicLocalScanPlanSchema>;

export const PublicLocalScanResultSchema = z.object({
  plan: PublicLocalScanPlanSchema.nullable(),
  localScanPlanHash: SourceKeySchema.nullable(),
}).strict().superRefine((result, context) => {
  if ((result.plan === null) !== (result.localScanPlanHash === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Public scan plan and hash must both be present or absent' });
  }
  if (result.plan !== null && result.localScanPlanHash !== result.plan.localScanPlanHash) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Public scan plan hash must match result hash' });
  }
});
export type PublicLocalScanResult = z.infer<typeof PublicLocalScanResultSchema>;

export function publicLocalScanPlan(plan: LocalScanPlan): PublicLocalScanPlan {
  return PublicLocalScanPlanSchema.parse({
    schemaVersion: plan.schemaVersion,
    provider: plan.provider,
    detectedVersion: plan.detectedVersion,
    capabilities: plan.capabilities,
    analysisMode: plan.analysisMode,
    limits: plan.limits,
    localScanPlanHash: plan.localScanPlanHash,
    sources: plan.sources.map(({ sourceKey, displayPath, action, indexState, estimatedFiles }) => ({
      sourceKey,
      displayPath,
      action,
      indexState,
      estimatedFiles,
    })),
  });
}

export interface StandardCodeFile {
  fileId: string;
  path: string;
  language: string;
  nodeCount: number;
  sizeBytes: number;
}

export const StandardCodeFileSchema: z.ZodType<StandardCodeFile> = z.object({
  fileId: z.string().min(1),
  path: PublicRelativeDisplayPathSchema,
  language: z.string().min(1),
  nodeCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
}).strict();

const ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const GeneratedRelativePathSchema = z.enum(['architecture/overview.md', 'architecture/entry-points.md']);
const GeneratedLogicalKeySchema = z.enum(['codegraph/architecture/overview', 'codegraph/architecture/entry-points']);
const GeneratedEvidenceIdSchema = z.enum(['snapshot:architecture/overview.md', 'snapshot:architecture/entry-points.md']);
const SafeWarningSchema = z.string().min(1).regex(/^[ -~]+$/u);

export const GeneratedKnowledgeRecordSchema = z.object({
  schemaVersion: z.literal('agentwiki-generated-code-knowledge@1'),
  relativePath: GeneratedRelativePathSchema,
  logicalKey: GeneratedLogicalKeySchema,
  title: z.string().min(1),
  analysisLayer: z.literal('base'),
  sourceKey: SourceKeySchema,
  snapshotHash: ContentHashSchema,
  contentHash: ContentHashSchema,
  evidenceIds: z.array(GeneratedEvidenceIdSchema).min(1).superRefine((evidenceIds, context) => {
    if (new Set(evidenceIds).size !== evidenceIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Evidence IDs must be unique' });
    evidenceIds.forEach((id, index) => {
      if (index > 0 && evidenceIds[index - 1]! >= id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Evidence IDs must use canonical code-unit order', path: [index] });
    });
  }),
}).strict().superRefine((record, context) => {
  const definitions = {
    'architecture/overview.md': { logicalKey: 'codegraph/architecture/overview', title: 'Repository overview', evidenceIds: ['snapshot:architecture/overview.md'] },
    'architecture/entry-points.md': { logicalKey: 'codegraph/architecture/entry-points', title: 'Repository entry points', evidenceIds: ['snapshot:architecture/entry-points.md'] },
  } as const;
  const expected = definitions[record.relativePath];
  if (record.logicalKey !== expected.logicalKey || record.title !== expected.title || record.evidenceIds.length !== expected.evidenceIds.length || record.evidenceIds.some((id, index) => id !== expected.evidenceIds[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Generated record fields did not match the canonical page tuple' });
  }
});

export interface GeneratedKnowledgeRecord {
  schemaVersion: 'agentwiki-generated-code-knowledge@1';
  relativePath: string;
  logicalKey: string;
  title: string;
  analysisLayer: 'base';
  sourceKey: string;
  snapshotHash: string;
  contentHash: string;
  evidenceIds: string[];
}

export const BaseAnalysisResultSchema = z.object({
  records: z.array(GeneratedKnowledgeRecordSchema),
  warnings: z.array(SafeWarningSchema),
}).strict().superRefine((result, context) => {
  const relativePaths = new Set<string>();
  const logicalKeys = new Set<string>();
  result.records.forEach((record, index) => {
    if (relativePaths.has(record.relativePath)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate generated relative path', path: ['records', index, 'relativePath'] });
    if (logicalKeys.has(record.logicalKey)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate generated logical key', path: ['records', index, 'logicalKey'] });
    relativePaths.add(record.relativePath);
    logicalKeys.add(record.logicalKey);
    if (index > 0 && result.records[index - 1]!.logicalKey >= record.logicalKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Generated records must use canonical logical-key order', path: ['records', index, 'logicalKey'] });
    }
  });
  result.warnings.forEach((warning, index) => {
    if (index > 0 && result.warnings[index - 1]! >= warning) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Warnings must use canonical code-unit order', path: ['warnings', index] });
  });
});

export interface BaseAnalysisResult {
  records: GeneratedKnowledgeRecord[];
  warnings: string[];
}
