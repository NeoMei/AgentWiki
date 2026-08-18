import { z } from 'zod';

const SourceKeySchema = z.string().regex(/^[a-f0-9]{64}$/u);

const NormalizedRelativePathSchema = z.string().min(1).superRefine((path, context) => {
  if (path.includes('\0')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Path must not contain NUL bytes' });
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

export const LocalScanPlanSchema = z.object({
  schemaVersion: z.literal('agentwiki-local-scan-plan@1'),
  provider: z.literal('codegraph'),
  executableIdentity: z.string().min(1),
  detectedVersion: z.string().min(1),
  capabilities: CodeGraphCapabilitiesSchema,
  analysisMode: AnalysisModeSchema,
  sources: z.array(CodeGraphSourcePlanSchema).min(1),
  limits: z.object({
    maxFiles: z.number().int().positive(),
    maxGeneratedBytes: z.number().int().positive(),
  }).strict(),
  localScanPlanHash: SourceKeySchema,
}).strict();
export type LocalScanPlan = z.infer<typeof LocalScanPlanSchema>;

export const StandardCodeFileSchema = z.object({
  fileId: z.string().min(1),
  path: NormalizedRelativePathSchema,
  language: z.string().min(1),
  nodeCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
}).strict();
export type StandardCodeFile = z.infer<typeof StandardCodeFileSchema>;
