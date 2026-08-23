export const validDefinition = {
  schemaVersion: 1 as const,
  inputs: [{ key: 'brief', label: 'Work brief', required: true, type: 'long_text' as const }],
  roleSlots: [
    { id: 'writer', name: 'Writer', required: true, description: 'Writes the draft' },
    { id: 'reviewer', name: 'Reviewer', required: true, description: 'Reviews the draft' },
  ],
  nodes: [
    {
      kind: 'agent_task' as const, id: 'draft', name: 'Draft', roleSlotId: 'writer', objective: 'Draft the work',
      inputKeys: ['brief'], upstreamArtifacts: [], output: { key: 'draft', kind: 'markdown' as const },
      evidenceRequired: [], humanAcceptance: false, leaseSeconds: 300, maxExecutionSeconds: 3600,
      retryBudget: 1, repairBudget: 1, skippable: false,
      todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
    },
    {
      kind: 'agent_task' as const, id: 'review', name: 'Agent review', roleSlotId: 'reviewer', objective: 'Review the draft',
      inputKeys: [], upstreamArtifacts: [{ key: 'draft', required: true }], output: { key: 'review', kind: 'markdown' as const },
      evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
      retryBudget: 1, repairBudget: 1, skippable: false,
      todos: [{ id: 'review', name: 'Review', required: true, evidenceKinds: [] }],
    },
  ],
  dependencies: [{ from: 'draft', to: 'review', mode: 'all' as const }],
  terminalNodeIds: ['review'],
};
