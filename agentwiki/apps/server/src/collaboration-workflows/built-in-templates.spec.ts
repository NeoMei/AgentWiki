import { CollaborationTemplateDefinitionSchema } from '@neomei/agentwiki-sync-protocol';
import { BUILT_IN_COLLABORATION_TEMPLATES } from './template-definitions';
import { validateCollaborationTemplate } from './template-validator';

const expectedNodes: Record<string, string[]> = {
  coding: [
    'requirements-analysis', 'implementation-plan', 'implement-module-a', 'implement-module-b',
    'run-tests', 'agent-code-review', 'fix-defects', 'release-summary', 'merge-release-review',
  ],
  'bid-writing': [
    'tender-analysis', 'material-catalog', 'bid-consensus-review', 'outline-and-mapping',
    'write-technical-sections', 'write-service-sections', 'missing-material-review',
    'coverage-and-visual-check', 'merge-and-polish', 'final-bid-review', 'export-reference',
  ],
  'paper-writing': [
    'research-scope', 'outline-review', 'literature-review', 'method-analysis', 'draft-chapters',
    'verify-citations', 'academic-edit', 'paper-final-review', 'paper-export-reference',
  ],
  'video-script-writing': [
    'creative-brief', 'fact-research', 'hook-and-structure', 'write-voiceover',
    'design-storyboard', 'duration-fact-brand-check', 'final-script', 'pre-production-review',
  ],
  'novel-writing': [
    'world-bible', 'character-bible', 'story-outline', 'outline-review', 'write-chapters',
    'continuity-check', 'style-edit', 'novel-final-review',
  ],
};

describe('built-in collaboration templates', () => {
  it('ships five stable deeply immutable seeds that pass schema and graph validation', () => {
    expect(BUILT_IN_COLLABORATION_TEMPLATES.map((item) => item.slug)).toEqual([
      'coding', 'bid-writing', 'paper-writing', 'video-script-writing', 'novel-writing',
    ]);
    for (const seed of BUILT_IN_COLLABORATION_TEMPLATES) {
      expect(seed.seedVersion).toBe(1);
      expect(seed.name.zh).toBeTruthy();
      expect(seed.name.en).toBeTruthy();
      expect(() => CollaborationTemplateDefinitionSchema.parse(seed.definition)).not.toThrow();
      expect(validateCollaborationTemplate(seed.definition)).toEqual([]);
      expect(seed.definition.nodes.map((node) => node.id)).toEqual(expectedNodes[seed.slug]);
      expect(Object.isFrozen(seed)).toBe(true);
      expect(Object.isFrozen(seed.definition)).toBe(true);
      expect(Object.isFrozen(seed.definition.nodes[0])).toBe(true);
    }
  });

  it('keeps exact review counts and domain-specific evidence gates', () => {
    const bySlug = (slug: string) => BUILT_IN_COLLABORATION_TEMPLATES.find((seed) => seed.slug === slug)!;
    const reviewCount = (slug: string) => bySlug(slug).definition.nodes.filter((node) => node.kind === 'human_review').length;
    const task = (slug: string, id: string) => {
      const node = bySlug(slug).definition.nodes.find((candidate) => candidate.id === id);
      if (!node || node.kind !== 'agent_task') throw new Error(`Missing Agent task ${slug}/${id}`);
      return node;
    };

    expect(reviewCount('coding')).toBe(1);
    expect(reviewCount('bid-writing')).toBe(3);
    expect(reviewCount('paper-writing')).toBe(2);
    expect(reviewCount('video-script-writing')).toBe(1);
    expect(reviewCount('novel-writing')).toBe(2);
    expect(task('novel-writing', 'write-chapters').objective).toContain('continuity dependencies');
    expect(task('paper-writing', 'verify-citations').evidenceRequired).toContain('source-verification');
    expect(task('coding', 'implement-module-a').evidenceRequired).toContain('commit-or-patch');
    expect(task('coding', 'run-tests').evidenceRequired).toContain('test-evidence');
    expect(task('bid-writing', 'export-reference').output.kind).toBe('external_reference');

    const videoReview = task('video-script-writing', 'duration-fact-brand-check');
    expect(videoReview.todos.map((todo) => todo.id)).toEqual(expect.arrayContaining([
      'check-duration', 'verify-facts', 'check-brand-tone',
    ]));
  });

  it('never claims that the control plane publishes or mutates repositories', () => {
    const serialized = JSON.stringify(BUILT_IN_COLLABORATION_TEMPLATES).toLowerCase();
    expect(serialized).not.toContain('automatically publish');
    expect(serialized).not.toContain('直接修改仓库');
  });

  it('gates bid consensus on both tender analysis and material catalog without an outline bypass', () => {
    const bid = BUILT_IN_COLLABORATION_TEMPLATES.find((seed) => seed.slug === 'bid-writing')!;
    const incoming = bid.definition.dependencies
      .filter((dependency) => dependency.to === 'bid-consensus-review')
      .map((dependency) => dependency.from)
      .sort();
    expect(incoming).toEqual(['material-catalog', 'tender-analysis']);
    expect(bid.definition.dependencies).not.toContainEqual({
      from: 'material-catalog', to: 'outline-and-mapping', mode: 'all',
    });
    expect(bid.definition.dependencies).toContainEqual({
      from: 'bid-consensus-review', to: 'outline-and-mapping', mode: 'all',
    });
  });
});
