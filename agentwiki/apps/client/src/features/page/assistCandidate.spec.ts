import { captureAssistTarget } from './assistTargets';
import { describe, expect, it } from 'vitest';
import { completeAssistCandidate, applyCandidateToDraft, canAcceptCandidate, type AssistCandidate, type AssistCurrent } from './assistCandidate';
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

describe('scoped candidate guard and edits', () => {
  const version = '2026-10-06T00:00:00Z';
  const scopedCurrent = { ...current, updatedAt: version, content: 'one\nkeep\ntwo\n' };
  const scoped = () => completeAssistCandidate({ ...candidate, baseUpdatedAt: version, baseContent: scopedCurrent.content, assistTarget: captureAssistTarget(scopedCurrent.content, 'document', 0, 0, version)!, status: 'generating' }, 'ONE\nkeep\nTWO\n');
  it('stages independent edits and revalidates source before each accepted edit', () => {
    const staged = scoped(); expect(staged.editPlan?.edits).toHaveLength(2);
    const first = applyCandidateToDraft(staged, scopedCurrent, 'edit-1');
    expect(first).toMatchObject({ status: 'applied', content: 'ONE\nkeep\ntwo\n', acceptedEditIds: ['edit-1'] });
    if (first.status !== 'applied') throw new Error('Expected apply');
    const partial = { ...staged, acceptedEditIds: first.acceptedEditIds };
    expect(canAcceptCandidate(partial, { ...scopedCurrent, content: first.content, draftRevision: 3 }, 'edit-2')).toBe(true);
    expect(applyCandidateToDraft(partial, { ...scopedCurrent, content: first.content }, 'edit-1').status).toBe('refused');
    expect(applyCandidateToDraft(partial, { ...scopedCurrent, content: 'ONE\nkeep\nhuman\n' }, 'edit-2').status).toBe('refused');
  });
  it.each([{ userId: 'other' }, { spaceId: 'other' }, { pageId: 'other' }, { updatedAt: 'new' }, { canEdit: false }, { remoteConflict: true }, { remoteRevision: 7 }, { title: 'renamed' }])('keeps scoped identity and remote guards %j', (change) => {
    expect(canAcceptCandidate(scoped(), { ...scopedCurrent, ...change }, 'edit-1')).toBe(false);
  });
  it('fails out of scope completion and accepts unrelated typing outside contextual selection', () => {
    const base = 'old' + 'x'.repeat(300) + 'quote' + 'y'.repeat(300);
    const target = captureAssistTarget(base, 'selection', 303, 308, version)!;
    const pending = { ...candidate, baseUpdatedAt: version, baseContent: base, assistTarget: target, status: 'generating' as const };
    expect(completeAssistCandidate(pending, base.replace('old', 'AGENT')).status).toBe('conflict');
    const done = completeAssistCandidate(pending, base.replace('quote', 'new'));
    expect(applyCandidateToDraft(done, { ...current, updatedAt: version, content: base.replace('old', 'human'), draftRevision: 3 })).toMatchObject({ status: 'applied', content: 'human' + 'x'.repeat(300) + 'new' + 'y'.repeat(300) });
  });
});

it('retains exact draft revision guard for whole document acceptance after typing and undo',()=>{
  const version='2026-10-06T00:00:00Z';
  const scoped=completeAssistCandidate({...candidate,baseUpdatedAt:version,assistTarget:captureAssistTarget('Draft','document',0,5,version)!},'Result');
  expect(canAcceptCandidate(scoped,{...current,updatedAt:version,draftRevision:3})).toBe(false);
});
