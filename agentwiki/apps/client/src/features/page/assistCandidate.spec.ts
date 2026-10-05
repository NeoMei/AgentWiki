import { describe, expect, it } from 'vitest';
import { canAcceptCandidate, type AssistCandidate, type AssistCurrent } from './assistCandidate';
const candidate: AssistCandidate = {
  taskId: 't1', pageId: 'p1', spaceId: 's1', userId: 'u1', baseTitle: 'Title', baseContent: 'Draft',
  baseUpdatedAt: 'v1', baseDraftRevision: 2, baseRemoteRevision: 0, content: 'Result', status: 'ready',
};
const current: AssistCurrent = {
  pageId: 'p1', spaceId: 's1', userId: 'u1', title: 'Title', content: 'Draft',
  updatedAt: 'v1', draftRevision: 2, remoteRevision: 0, canEdit: true,
};
describe('whole-document candidate guard', () => {
  it('allows only the exact submitted draft in its authorized identity', () => {
    expect(canAcceptCandidate(candidate, current)).toBe(true);
  });
  it.each([
    { pageId: 'p2' }, { spaceId: 's2' }, { userId: 'u2' }, { canEdit: false },
    { title: 'Renamed' }, { content: 'Human edits' }, { updatedAt: 'v2' },
    { draftRevision: 3 }, { remoteRevision: 1 }, { remoteConflict: true },
  ])('rejects changed context %j', (change) => {
    expect(canAcceptCandidate(candidate, { ...current, ...change })).toBe(false);
  });
  it.each(['generating', 'accepted', 'discarded', 'conflict', 'failed', 'empty'] as const)('rejects %s candidates', (status) => {
    expect(canAcceptCandidate({ ...candidate, status }, current)).toBe(false);
  });
  it('never erases a draft using an empty or whitespace output', () => {
    expect(canAcceptCandidate({ ...candidate, content: '' }, current)).toBe(false);
    expect(canAcceptCandidate({ ...candidate, content: '\n  ' }, current)).toBe(false);
  });
});
