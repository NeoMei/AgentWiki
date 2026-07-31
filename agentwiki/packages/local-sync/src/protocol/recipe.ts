import { z } from 'zod';

/**
 * A Recipe is a versioned, deterministic control program that defines how a
 * class of knowledge jobs should be organized, validated, and synced. Recipes
 * live alongside the Orchestrator, not inside the Agent prompt.
 */

export const RecipeStepSchema = z.object({
  stepId: z.string().min(1),
  phase: z.enum(['discover', 'collect', 'organize', 'validate', 'preview', 'confirm', 'push', 'pull', 'merge']),
  description: z.string().min(1),
  requiredArtifactKinds: z.array(z.enum(['code', 'document', 'memory', 'relation'])).optional(),
  maxWorkItems: z.number().int().positive().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  dependsOn: z.array(z.string().min(1)).optional(),
});

export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeConstraintSchema = z.object({
  maxBundleBytes: z.number().int().positive().optional(),
  maxBundleItems: z.number().int().positive().optional(),
  maxRepairCycles: z.number().int().nonnegative().default(3),
  maxArtifactsPerWorkItem: z.number().int().positive().default(10),
  maxConflictFields: z.number().int().positive().default(20),
  requireProvenance: z.boolean().default(true),
  requireEvidence: z.boolean().default(true),
  sensitivityGate: z.enum(['none', 'shareable-only', 'review-required-allowed']).default('shareable-only'),
});

export type RecipeConstraint = z.infer<typeof RecipeConstraintSchema>;

export const RecipeSchema = z.object({
  recipeId: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(RecipeStepSchema).min(1),
  constraints: RecipeConstraintSchema,
  requiredArtifactKinds: z.array(z.enum(['code', 'document', 'memory', 'relation'])).optional(),
  identityFields: z.array(z.string().min(1)).default(['pageId']),
  mergeStrategy: z.enum(['by-field', 'last-write-wins', 'manual-only']).default('by-field'),
});

export type Recipe = z.infer<typeof RecipeSchema>;

export function assertRecipe(value: unknown): Recipe {
  return RecipeSchema.parse(value);
}

export function assertRecipeStep(value: unknown): RecipeStep {
  return RecipeStepSchema.parse(value);
}

export function assertRecipeConstraint(value: unknown): RecipeConstraint {
  return RecipeConstraintSchema.parse(value);
}
