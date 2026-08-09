import { describe, expect, it } from 'vitest';

import { planPhaseWorkItems } from './core/orchestrator.js';
import { assertRecipe } from './protocol/recipe.js';
import { defaultRecipes } from './recipes.js';

describe('default recipes', () => {
  it('are schema-valid and create an executable first work item', () => {
    const recipes = defaultRecipes();
    expect(recipes.map((recipe) => assertRecipe(recipe))).toHaveLength(2);

    const code = recipes.find((recipe) => recipe.recipeId === 'code-wiki@1')!;
    const documents = recipes.find((recipe) => recipe.recipeId === 'document-library@1')!;
    expect(planPhaseWorkItems(code, 'discover')[0]?.artifactIds).toEqual(['codebase-memory']);
    expect(planPhaseWorkItems(documents, 'discover')[0]?.artifactIds).toEqual(['markitdown']);
  });
});
