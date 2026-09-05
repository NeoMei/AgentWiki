import { resolveParticipants } from './run-page-selection';

describe('resolveParticipants', () => {
  it('ignores a disabled task default even when it shares an enabled task role', () => {
    expect(resolveParticipants([
      { nodeId: 'enabled-page', roleSlotId: 'writer', enabled: true },
      { nodeId: 'disabled-page', roleSlotId: 'writer', enabled: false },
    ], [
      { kind: 'task_default', nodeId: 'enabled-page', roleSlotId: 'writer', agentId: 'agent-a' },
      { kind: 'task_default', nodeId: 'disabled-page', roleSlotId: 'writer', agentId: 'agent-b' },
    ])).toEqual({
      assignments: [{ nodeId: 'enabled-page', roleSlotId: 'writer', agentId: 'agent-a' }],
      agentIds: ['agent-a'],
      issues: [],
    });
  });

  it('reports a conflict when enabled task defaults disagree for one role', () => {
    expect(resolveParticipants([
      { nodeId: 'second', roleSlotId: 'writer', enabled: true },
      { nodeId: 'first', roleSlotId: 'writer', enabled: true },
    ], [
      { kind: 'task_default', nodeId: 'second', roleSlotId: 'writer', agentId: 'agent-z' },
      { kind: 'task_default', nodeId: 'first', roleSlotId: 'writer', agentId: 'agent-a' },
    ])).toEqual({
      assignments: [],
      agentIds: [],
      issues: [{
        code: 'ROLE_BINDING_CONFLICT',
        roleSlotId: 'writer',
        nodeIds: ['first', 'second'],
        agentIds: ['agent-a', 'agent-z'],
      }],
    });
  });

  it('uses one explicit role override to resolve conflicting task defaults', () => {
    expect(resolveParticipants([
      { nodeId: 'first', roleSlotId: 'writer', enabled: true },
      { nodeId: 'second', roleSlotId: 'writer', enabled: true },
    ], [
      { kind: 'task_default', nodeId: 'first', roleSlotId: 'writer', agentId: 'agent-a' },
      { kind: 'task_default', nodeId: 'second', roleSlotId: 'writer', agentId: 'agent-b' },
      { kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-chosen' },
    ])).toEqual({
      assignments: [
        { nodeId: 'first', roleSlotId: 'writer', agentId: 'agent-chosen' },
        { nodeId: 'second', roleSlotId: 'writer', agentId: 'agent-chosen' },
      ],
      agentIds: ['agent-chosen'],
      issues: [],
    });
  });

  it('omits an override for a role used only by disabled tasks', () => {
    expect(resolveParticipants([
      { nodeId: 'a', roleSlotId: 'writer', enabled: true },
      { nodeId: 'b', roleSlotId: 'unused', enabled: false },
    ], [
      { kind: 'task_default', nodeId: 'a', roleSlotId: 'writer', agentId: 'agent-a' },
      { kind: 'role_override', roleSlotId: 'unused', agentId: 'agent-b' },
    ])).toEqual({
      assignments: [{ nodeId: 'a', roleSlotId: 'writer', agentId: 'agent-a' }],
      agentIds: ['agent-a'],
      issues: [],
    });
  });

  it('deduplicates one Agent assigned to multiple enabled roles', () => {
    expect(resolveParticipants([
      { nodeId: 'research', roleSlotId: 'researcher', enabled: true },
      { nodeId: 'draft', roleSlotId: 'writer', enabled: true },
    ], [
      { kind: 'task_default', nodeId: 'research', roleSlotId: 'researcher', agentId: 'agent-a' },
      { kind: 'task_default', nodeId: 'draft', roleSlotId: 'writer', agentId: 'agent-a' },
    ])).toEqual({
      assignments: [
        { nodeId: 'research', roleSlotId: 'researcher', agentId: 'agent-a' },
        { nodeId: 'draft', roleSlotId: 'writer', agentId: 'agent-a' },
      ],
      agentIds: ['agent-a'],
      issues: [],
    });
  });

  it('returns stable required issues for enabled tasks without a binding', () => {
    expect(resolveParticipants([
      { nodeId: 'z-task', roleSlotId: 'z-role', enabled: true },
      { nodeId: 'a-task', roleSlotId: 'a-role', enabled: true },
      { nodeId: 'ignored', roleSlotId: 'missing-disabled', enabled: false },
    ], [])).toEqual({
      assignments: [],
      agentIds: [],
      issues: [
        { code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'a-role', nodeIds: ['a-task'] },
        { code: 'ROLE_BINDING_REQUIRED', roleSlotId: 'z-role', nodeIds: ['z-task'] },
      ],
    });
  });

  it('returns a conflict for multiple distinct explicit overrides of one used role', () => {
    expect(resolveParticipants([
      { nodeId: 'draft', roleSlotId: 'writer', enabled: true },
    ], [
      { kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-z' },
      { kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-a' },
      { kind: 'role_override', roleSlotId: 'writer', agentId: 'agent-z' },
    ])).toEqual({
      assignments: [],
      agentIds: [],
      issues: [{
        code: 'ROLE_BINDING_CONFLICT',
        roleSlotId: 'writer',
        nodeIds: ['draft'],
        agentIds: ['agent-a', 'agent-z'],
      }],
    });
  });
});
