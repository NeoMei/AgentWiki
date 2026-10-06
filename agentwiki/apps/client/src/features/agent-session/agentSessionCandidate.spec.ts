import { describe, expect, it } from 'vitest';
import { candidateFromTurn, bindCandidate } from './agentSessionCandidate';
import { captureAssistTarget } from '../page/assistTargets';
import { applyCandidateToDraft, type AssistCurrent } from '../page/assistCandidate';
import type { AgentTurn } from './agentSessionTypes';
const updatedAt = '2026-10-06T01:00:00.000Z';
const source = 'first\n' + 'middle unchanged\n'.repeat(40) + 'last\n';
const turn: AgentTurn = { id: 't', sessionId: 's', pageId: 'p', mode: 'proposal', intent: 'change', status: 'done', createdAt: updatedAt, pageSnapshot: { title: 'Title', content: source, updatedAt, draftRevision: 999, remoteRevision: 99, assistTarget: captureAssistTarget(source, 'document', 0, source.length, updatedAt)! }, references: [], noteIds: ['n'], annotations: [], progressText: '', result: { summary: 'Changed', changes: source.replace('first', 'FIRST').replace('last', 'LAST') }, error: null };
const current: AssistCurrent = { pageId: 'p', spaceId: 'space', userId: 'u', title: 'Title', content: source, updatedAt, draftRevision: 1, remoteRevision: 0, canEdit: true };
describe('historical candidate binding', () => {
  it('rebinds local revisions only on exact immutable source/version and preserves source', () => {
    const record = candidateFromTurn(turn, 'u', 'space'); expect(record).not.toBeNull();
    const bound = bindCandidate(record!, current, {});
    expect(bound.baseContent).toBe(source); expect(bound.baseDraftRevision).toBe(1); expect(bound.baseRemoteRevision).toBe(0);
    expect(bound.editPlan?.edits).toHaveLength(2); expect(applyCandidateToDraft(bound, current, 'edit-1').status).toBe('applied');
  });
  it.each([{ content: source + ' ' }, { updatedAt: '2026-10-06T02:00:00Z' }, { title: 'New title' }, { remoteConflict: true }, { pageId: 'other' }, { userId: 'other' }, { spaceId: 'other' }, { canEdit: false }])('refuses rebinding an altered baseline %j', (patch) => {
    const record = candidateFromTurn(turn, 'u', 'space')!;
    expect(record).not.toBeNull();
    expect(bindCandidate(record, { ...current, ...patch }, {}).status).toBe('conflict');
  });
  it('keeps same-mount guards and rebinds only exact replayed accepted content after remount', () => {
    const record = candidateFromTurn(turn, 'u', 'space')!, mount = {};
    expect(record).not.toBeNull();
    const first = bindCandidate(record, current, mount);
    const applied = applyCandidateToDraft(first, current, 'edit-1'); expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') throw new Error('expected apply');
    record.candidate = { ...first, acceptedEditIds: ['edit-1'] };
    expect(bindCandidate(record, { ...current, content: applied.content, draftRevision: 50 }, mount).baseDraftRevision).toBe(1);
    const rebound = bindCandidate(record, { ...current, content: applied.content, draftRevision: 10 }, {});
    expect(rebound.acceptedEditIds).toEqual(['edit-1']); expect(rebound.baseDraftRevision).toBe(10);
    expect(applyCandidateToDraft(rebound, { ...current, content: applied.content, draftRevision: 10 }, 'edit-1').status).toBe('refused');
    expect(bindCandidate(record, { ...current, content: applied.content + 'manual' }, {}).status).toBe('conflict');
  });
});
