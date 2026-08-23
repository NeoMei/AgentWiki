import { CollaborationTemplateDefinitionSchema } from '@neomei/agentwiki-sync-protocol';
import { hashCollaborationTemplate, validateCollaborationTemplate } from './template-validator';

const task = (id: string, output = id) => ({
  kind: 'agent_task' as const,
  id,
  name: id,
  roleSlotId: 'writer',
  objective: `Complete ${id}`,
  inputKeys: [],
  upstreamArtifacts: [],
  output: { key: output, kind: 'markdown' as const },
  evidenceRequired: [],
  humanAcceptance: false,
  leaseSeconds: 300,
  maxExecutionSeconds: 3600,
  retryBudget: 1,
  repairBudget: 1,
  skippable: false,
  todos: [{ id: 'complete', name: 'Complete', required: true, evidenceKinds: [] }],
});

const validDefinition = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const,
  inputs: [],
  roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
  nodes: [task('a', 'a-output'), task('b', 'b-output')],
  dependencies: [{ from: 'a', to: 'b', mode: 'all' as const }],
  terminalNodeIds: ['b'],
  ...overrides,
});

describe('collaboration template validator', () => {
  it.each([
    ['cycle', [{ from: 'a', to: 'b', mode: 'all' }, { from: 'b', to: 'a', mode: 'all' }], 'DEPENDENCY_CYCLE'],
    ['missing node', [{ from: 'missing', to: 'a', mode: 'all' }], 'DEPENDENCY_NODE_MISSING'],
  ] as const)('rejects %s', (_name, dependencies, code) => {
    expect(validateCollaborationTemplate(validDefinition({ dependencies }))).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it('rejects reachability, entry, terminal, revision, key, review-edge, artifact, and any defects', () => {
    const invalid = validDefinition({
      inputs: [
        { key: 'topic', label: 'Topic', required: true, type: 'short_text' },
        { key: 'topic', label: 'Duplicate', required: false, type: 'short_text' },
      ],
      nodes: [
        task('a', 'shared'),
        { ...task('b', 'shared'), upstreamArtifacts: [{ key: 'missing-output', required: true }] },
        {
          kind: 'human_review',
          id: 'review',
          name: 'Review',
          artifactTaskId: 'b',
          minimumRole: 'editor',
          reviewerUserIds: [],
          approvalCriteria: ['Complete'],
          revisionTaskId: 'review',
          allowTerminate: true,
        },
        task('unrelated', 'unrelated-output'),
      ],
      dependencies: [
        { from: 'a', to: 'b', mode: 'any' },
        { from: 'unrelated', to: 'b', mode: 'any' },
      ],
      terminalNodeIds: ['missing-terminal'],
    });
    const codes = [...new Set(validateCollaborationTemplate(invalid).map((issue) => issue.code))];
    expect(codes).toEqual(expect.arrayContaining([
      'REQUIRED_NODE_UNREACHABLE',
      'TERMINAL_NODE_MISSING',
      'REVISION_TARGET_INVALID',
      'KEY_DUPLICATE',
      'REVIEW_SOURCE_EDGE_MISSING',
      'UPSTREAM_ARTIFACT_UNREACHABLE',
    ]));

    const unsafeAny = validDefinition({
      nodes: [
        task('a', 'a-output'),
        task('c', 'c-output'),
        { ...task('b', 'b-output'), upstreamArtifacts: [{ key: 'a-output', required: true }] },
      ],
      dependencies: [
        { from: 'a', to: 'b', mode: 'any' },
        { from: 'c', to: 'b', mode: 'any' },
      ],
      terminalNodeIds: ['b'],
    });
    expect(validateCollaborationTemplate(unsafeAny)).toContainEqual(
      expect.objectContaining({ code: 'ANY_REQUIRED_ARTIFACT_UNSAFE' }),
    );
  });

  it('detects a missing entry and conflicting incoming modes', () => {
    const definition = validDefinition({
      dependencies: [
        { from: 'a', to: 'b', mode: 'all' },
        { from: 'b', to: 'a', mode: 'any' },
      ],
      terminalNodeIds: ['a'],
    });
    const codes = validateCollaborationTemplate(definition).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['ENTRY_NODE_MISSING', 'DEPENDENCY_CYCLE']));

    const mixed = validDefinition({
      nodes: [task('a'), task('b'), task('c')],
      dependencies: [
        { from: 'a', to: 'c', mode: 'all' },
        { from: 'b', to: 'c', mode: 'any' },
      ],
      terminalNodeIds: ['c'],
    });
    expect(validateCollaborationTemplate(mixed)).toContainEqual(
      expect.objectContaining({ code: 'DEPENDENCY_MODE_CONFLICT' }),
    );
  });

  it('rejects indirect and nested any releases that do not guarantee a required Artifact', () => {
    const indirect = validDefinition({
      nodes: [
        task('producer', 'required'),
        task('relay'),
        task('bypass'),
        { ...task('consumer'), upstreamArtifacts: [{ key: 'required', required: true }] },
      ],
      dependencies: [
        { from: 'producer', to: 'relay', mode: 'all' },
        { from: 'relay', to: 'consumer', mode: 'any' },
        { from: 'bypass', to: 'consumer', mode: 'any' },
      ],
      terminalNodeIds: ['consumer'],
    });
    expect(validateCollaborationTemplate(indirect)).toContainEqual(
      expect.objectContaining({ code: 'ANY_REQUIRED_ARTIFACT_UNSAFE' }),
    );

    const nestedAny = validDefinition({
      nodes: [
        task('producer', 'required'),
        task('alternate'),
        task('inner'),
        task('outer-bypass'),
        { ...task('consumer'), upstreamArtifacts: [{ key: 'required', required: true }] },
      ],
      dependencies: [
        { from: 'producer', to: 'inner', mode: 'any' },
        { from: 'alternate', to: 'inner', mode: 'any' },
        { from: 'inner', to: 'consumer', mode: 'any' },
        { from: 'outer-bypass', to: 'consumer', mode: 'any' },
      ],
      terminalNodeIds: ['consumer'],
    });
    expect(validateCollaborationTemplate(nestedAny)).toContainEqual(
      expect.objectContaining({ code: 'ANY_REQUIRED_ARTIFACT_UNSAFE' }),
    );
  });

  it('accepts nested any joins when every release path guarantees the required Artifact', () => {
    const definition = validDefinition({
      nodes: [
        task('producer', 'required'),
        task('left'),
        task('right'),
        task('inner'),
        task('outer'),
        { ...task('consumer'), upstreamArtifacts: [{ key: 'required', required: true }] },
      ],
      dependencies: [
        { from: 'producer', to: 'left', mode: 'all' },
        { from: 'producer', to: 'right', mode: 'all' },
        { from: 'left', to: 'inner', mode: 'any' },
        { from: 'right', to: 'inner', mode: 'any' },
        { from: 'producer', to: 'outer', mode: 'all' },
        { from: 'inner', to: 'consumer', mode: 'any' },
        { from: 'outer', to: 'consumer', mode: 'any' },
      ],
      terminalNodeIds: ['consumer'],
    });
    expect(validateCollaborationTemplate(definition)).toEqual([]);
  });

  it('rejects required Artifact paths that a skippable producer or relay can bypass', () => {
    const skippableProducer = validDefinition({
      nodes: [
        { ...task('producer', 'required'), skippable: true },
        { ...task('consumer'), upstreamArtifacts: [{ key: 'required', required: true }] },
      ],
      dependencies: [{ from: 'producer', to: 'consumer', mode: 'all' }],
      terminalNodeIds: ['consumer'],
    });
    expect(validateCollaborationTemplate(skippableProducer)).toContainEqual(
      expect.objectContaining({ code: 'ANY_REQUIRED_ARTIFACT_UNSAFE' }),
    );

    const skippableRelay = validDefinition({
      nodes: [
        task('producer', 'required'),
        { ...task('relay'), skippable: true },
        { ...task('consumer'), upstreamArtifacts: [{ key: 'required', required: true }] },
      ],
      dependencies: [
        { from: 'producer', to: 'relay', mode: 'all' },
        { from: 'relay', to: 'consumer', mode: 'all' },
      ],
      terminalNodeIds: ['consumer'],
    });
    expect(validateCollaborationTemplate(skippableRelay)).toContainEqual(
      expect.objectContaining({ code: 'ANY_REQUIRED_ARTIFACT_UNSAFE' }),
    );
  });

  it('hashes canonical object-key order and accepts a sound graph', () => {
    const definition = CollaborationTemplateDefinitionSchema.parse(validDefinition());
    expect(validateCollaborationTemplate(definition)).toEqual([]);
    expect(hashCollaborationTemplate(definition)).toBe(hashCollaborationTemplate({
      ...definition,
      roleSlots: definition.roleSlots.map((role) => ({
        description: role.description,
        required: role.required,
        name: role.name,
        id: role.id,
      })),
    }));
  });
});
