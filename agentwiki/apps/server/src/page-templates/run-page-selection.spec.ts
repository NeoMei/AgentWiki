import { resolveParticipants } from './run-page-selection';

describe('resolveParticipants', () => {
  it('excludes bindings used only by disabled tasks', () => {
    expect(resolveParticipants([
      { nodeId: 'a', roleSlotId: 'writer', enabled: true },
      { nodeId: 'b', roleSlotId: 'unused', enabled: false },
    ], [
      { roleSlotId: 'writer', agentId: 'agent-a' },
      { roleSlotId: 'unused', agentId: 'agent-b' },
    ])).toEqual({
      assignments: [{ nodeId: 'a', roleSlotId: 'writer', agentId: 'agent-a' }],
      agentIds: ['agent-a'],
      issues: [],
    });
  });

  it('deduplicates one Agent assigned to multiple enabled tasks', () => {
    expect(resolveParticipants([
      { nodeId: 'research', roleSlotId: 'researcher', enabled: true },
      { nodeId: 'draft', roleSlotId: 'writer', enabled: true },
    ], [
      { roleSlotId: 'researcher', agentId: 'agent-a' },
      { roleSlotId: 'writer', agentId: 'agent-a' },
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

  it('returns one stable conflict when the same role has different default Agents', () => {
    expect(resolveParticipants([
      { nodeId: 'second', roleSlotId: 'writer', enabled: true },
      { nodeId: 'first', roleSlotId: 'writer', enabled: true },
    ], [
      { roleSlotId: 'writer', agentId: 'agent-z' },
      { roleSlotId: 'writer', agentId: 'agent-a' },
      { roleSlotId: 'writer', agentId: 'agent-z' },
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
});
