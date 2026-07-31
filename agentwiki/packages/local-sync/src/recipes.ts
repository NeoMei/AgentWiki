import type { Recipe } from './protocol/recipe.js';

export const DEFAULT_RECIPES: Recipe[] = [
  {
    recipeId: 'code-wiki@1',
    version: '1',
    name: 'Code Wiki',
    description: 'Organize a codebase into a structured wiki with modules, data flow, and dependencies.',
    steps: [],
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
    steps: [],
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
