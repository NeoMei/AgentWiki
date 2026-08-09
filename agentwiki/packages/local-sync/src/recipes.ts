import type { Recipe } from './protocol/recipe.js';

export const DEFAULT_RECIPES: Recipe[] = [
  {
    recipeId: 'code-wiki@1',
    version: '1',
    name: 'Code Wiki',
    description: 'Organize a codebase into a structured wiki with modules, data flow, and dependencies.',
    steps: [{
      stepId: 'inspect-codebase',
      phase: 'discover',
      description: 'Inspect the codebase locally, then organize the returned architecture evidence into a shareable Wiki page.',
      requiredArtifactKinds: ['code'],
      maxWorkItems: 1,
      retryCount: 2,
    }],
    constraints: {
      maxRepairCycles: 3,
      maxArtifactsPerWorkItem: 10,
      maxConflictFields: 20,
      requireProvenance: true,
      requireEvidence: true,
      sensitivityGate: 'review-required-allowed',
    },
    requiredArtifactKinds: ['code'],
    identityFields: ['pageId'],
    mergeStrategy: 'by-field',
  },
  {
    recipeId: 'document-library@1',
    version: '1',
    name: 'Document Library',
    description: 'Organize a document folder into a topic-indexed library with references and facts.',
    steps: [{
      stepId: 'inspect-documents',
      phase: 'discover',
      description: 'Inspect the document directory locally, then organize the returned summaries into a shareable Wiki page.',
      requiredArtifactKinds: ['document'],
      maxWorkItems: 1,
      retryCount: 2,
    }],
    constraints: {
      maxRepairCycles: 3,
      maxArtifactsPerWorkItem: 10,
      maxConflictFields: 20,
      requireProvenance: true,
      requireEvidence: true,
      sensitivityGate: 'review-required-allowed',
    },
    requiredArtifactKinds: ['document'],
    identityFields: ['pageId'],
    mergeStrategy: 'by-field',
  },
];

export function defaultRecipes(): Recipe[] {
  return DEFAULT_RECIPES;
}
