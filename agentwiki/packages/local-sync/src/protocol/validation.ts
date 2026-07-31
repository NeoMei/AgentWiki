import { z } from 'zod';

/**
 * Structured validation issues returned by the Orchestrator. Validation is
 * deterministic and rule-based; repairs are emitted as work items for the
 * local Agent.
 */

export const ValidationIssueSchema = z.object({
  itemId: z.string().min(1),
  rule: z.string().min(1),
  artifactIds: z.array(z.string().min(1)).default([]),
  repairable: z.boolean(),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']).default('error'),
  field: z.string().optional(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationRuleSchema = z.object({
  ruleId: z.string().min(1),
  appliesTo: z.array(z.enum(['bundle', 'page', 'memory', 'relation', 'artifact', 'provenance', 'deletion'])),
  severity: z.enum(['error', 'warning']),
  messageTemplate: z.string().min(1),
  enabled: z.boolean().default(true),
});

export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

export const ValidationResultSchema = z.object({
  jobId: z.string().min(1),
  phase: z.enum(['validate', 'preview', 'confirm']),
  passed: z.boolean(),
  issues: z.array(ValidationIssueSchema),
  rules: z.array(ValidationRuleSchema),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export function assertValidationIssue(value: unknown): ValidationIssue {
  return ValidationIssueSchema.parse(value);
}

export function assertValidationRule(value: unknown): ValidationRule {
  return ValidationRuleSchema.parse(value);
}

export function assertValidationResult(value: unknown): ValidationResult {
  return ValidationResultSchema.parse(value);
}
