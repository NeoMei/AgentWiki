import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageNotesApi } from './pageNotesApi';
import type { PersonalNote } from './reviewComments';
import { usePersonalNotes } from './usePersonalNotes';
import { captureAssistTarget } from './assistTargets';
import { completeAssistCandidate, type AssistCandidate } from './assistCandidate';
import { addPersonalNote, personalNotesKey, savePersonalNotes } from './reviewComments';
import type { AssistNotesEvent, AssistRequest } from './AgentAssistPanel';
const scope={userId:'u',spaceId:'s',pageId:'p'}, version='2026-10-06T00:00:00Z', source='one\nkeep\ntwo\n';
const first=captureAssistTarget(source,'selection',0,3,version)!, second=captureAssistTarget(source,'selection',9,12,version)!;
const candidate=(ids:string[], target:any):AssistCandidate=>completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:source,baseUpdatedAt:version,assistTarget:target,noteIds:ids,content:'',status:'generating'},'ONE\nkeep\nTWO\n');
vi.mock('./pageNotesApi', () => ({ pageNotesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() } }));
let server: PersonalNote[] = [], revision = 0;
const serverNote = (note: PersonalNote) => ({ ...note, author: { type: 'user' as const, id: note.userId, name: note.userId }, canEdit: true, createdAt: version, updatedAt: String(++revision), clientNoteId: note.id });
beforeEach(() => {
  localStorage.clear(); server = []; revision = 0; vi.resetAllMocks();
  vi.mocked(pageNotesApi.list).mockImplementation(async (current) => ({ notes: structuredClone(server.filter((note) => note.spaceId === current.spaceId && note.pageId === current.pageId).map((note) => ({ ...note, canEdit: note.userId === current.userId }))), canCreate: true }));
  vi.mocked(pageNotesApi.create).mockImplementation(async (current, input) => {
    const existing = server.find((note) => note.clientNoteId === input.clientNoteId && note.userId === current.userId && note.pageId === current.pageId);
    if (existing) return structuredClone(existing);
    const note = serverNote({ ...addPersonalNote(current, input.target, input.body, input.clientNoteId), status: input.status ?? 'pending', ...(input.taskId ? { taskId: input.taskId } : {}) });
    server.push(note); return structuredClone(note);
  });
  vi.mocked(pageNotesApi.update).mockImplementation(async (current, id, input) => {
    const index = server.findIndex((note) => note.id === id && note.userId === current.userId);
    if (index < 0 || server[index].updatedAt !== input.expectedUpdatedAt) throw new Error('conflict');
    server[index] = { ...server[index], ...input, taskId: input.taskId ?? undefined, updatedAt: String(++revision) };
    return structuredClone(server[index]);
  });
}); afterEach(cleanup);

describe('scoped personal notes controller',()=>{
  it('persists notes, dispatches a bounded anchored batch, and only resolves accepted covered changes',async()=>{
    const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version,language:'en'})); await act(async () => {});
    await act(async()=>{await result.current.add(first,'Fix one');await result.current.add(second,'Fix two');});
    const ids=result.current.notes.map(n=>n.id);
    await act(async()=>{expect(result.current.dispatch(ids)).toBe(true);});
    const request=result.current.assistRequest!;
    expect(request).toMatchObject({noteIds:ids,assistTarget:{from:0,to:12,quote:'one\nkeep\ntwo'}});
    expect(request.intent).toContain('Fix one');expect(request.intent).toContain('"quote":"two"');
    const done=candidate(ids,request.assistTarget);
    await act(async()=>result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['dispatched','dispatched']);
    await act(async()=>result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['awaiting-review','awaiting-review']);
    await act(async()=>result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:{...done,acceptedEditIds:['edit-1']},editId:'edit-1',acceptedEditIds:['edit-1']}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','awaiting-review']);
    await act(async()=>result.current.onNotesEvent({event:'discard',taskId:'task',noteIds:ids,candidate:done}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','pending']);
    expect(server.map((n)=>n.status)).toEqual(['resolved','pending']);
  });
  it('clears visibility on account/permission changes and ignores delayed callbacks even after return',async()=>{
    const {result,rerender}=renderHook((props)=>usePersonalNotes(props),{initialProps:{scope,canEdit:true,source,updatedAt:version}}); await act(async () => {});
    await act(async()=>await result.current.add(first,'private'));
    const oldAdd=result.current.add, oldEvent=result.current.onNotesEvent;
    const id=result.current.notes[0].id;await act(async()=>{result.current.dispatch([id]);});const done=candidate([id],result.current.assistRequest?.assistTarget);
    rerender({scope:{...scope,userId:'other'},canEdit:true,source,updatedAt:version});expect(result.current.notes).toEqual([]);
    await act(async()=>{await oldAdd(first,'leak');oldEvent({event:'dispatch',taskId:'task',noteIds:[id],candidate:done});});expect(result.current.notes).toMatchObject([{ body:'private', canEdit:false, status:'pending' }]);
    rerender({scope,canEdit:false,source,updatedAt:version});expect(result.current.notes).toEqual([]);expect(result.current.assistRequest).toBeNull();
    rerender({scope,canEdit:true,source,updatedAt:version});await act(async () => {});expect(result.current.notes[0].status).toBe('pending');
    await act(async()=>oldEvent({event:'dispatch',taskId:'task',noteIds:[id],candidate:done}));expect(result.current.notes[0].status).toBe('pending');
  });
  it('supports explicit reopen after reload and refuses orphan batch without losing quotes',async()=>{
    const hook=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version})); await act(async () => {});
    await act(async()=>await hook.result.current.add(first,'note'));const id=hook.result.current.notes[0].id;await act(async()=>{hook.result.current.dispatch([id]);});const done=candidate([id],hook.result.current.assistRequest?.assistTarget);
    await act(async()=>hook.result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:[id],candidate:done}));hook.unmount();
    const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:'changed',updatedAt:version})); await act(async () => {});
    expect(result.current.notes[0].status).toBe('dispatched');await act(async()=>result.current.reopen(id));expect(result.current.notes[0].status).toBe('pending');
    await act(async()=>{expect(result.current.dispatch([id])).toBe(false);});expect(result.current.notes[0].target.quote).toBe('one');expect(result.current.assistRequest).toBeNull();
  });
});

it('supports explicit resolve by the note author and persists it without an Agent task', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Close this note', 'own')), status: 'pending' }];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  await act(async () => { result.current.resolve('own'); });
  expect(result.current.notes[0]).toMatchObject({ id: 'own', status: 'resolved' });
  expect(server[0]).toMatchObject({ id: 'own', status: 'resolved', taskId: undefined });
  expect(pageNotesApi.update).toHaveBeenCalledWith(scope, 'own', expect.objectContaining({ status: 'resolved', taskId: null }), expect.any(AbortSignal));
});

it('uses latest source/version and retains draft ownership when the server rejects a save', async () => {
  const { result, rerender } = renderHook((props) => usePersonalNotes(props), { initialProps: { scope, canEdit: true, source, updatedAt: version } }); await act(async () => {});
  const oldAdd = result.current.add;
  rerender({ scope, canEdit: true, source: 'changed', updatedAt: version });
  await act(async () => { expect(await oldAdd(first, 'stale')).toBe(false); }); expect(result.current.notes).toEqual([]);
  rerender({ scope, canEdit: true, source, updatedAt: version });
  vi.mocked(pageNotesApi.create).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { expect(await result.current.add(first, 'keep draft')).toBe(false); });
  expect(result.current.storageUnavailable).toBe(true); expect(result.current.notes).toEqual([]);
  await act(async () => { expect(await result.current.add(first, 'keep draft')).toBe(true); });
  expect(pageNotesApi.create).toHaveBeenCalledTimes(2);
  expect(vi.mocked(pageNotesApi.create).mock.calls[0][1].clientNoteId).toBe(vi.mocked(pageNotesApi.create).mock.calls[1][1].clientNoteId);
  expect(result.current.notes[0].body).toBe('keep draft'); expect(localStorage.length).toBe(0);
});

it('keeps a note spanning multiple hunks awaiting review until all its changes are accepted',async()=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version})); await act(async () => {});
  await act(async()=>await result.current.add(captureAssistTarget(source,'selection',0,12,version)!,'Fix both'));
  const ids=result.current.notes.map(n=>n.id);await act(async()=>{result.current.dispatch(ids);});const done=candidate(ids,result.current.assistRequest?.assistTarget);
  await act(async()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes[0].status).toBe('awaiting-review');
  await act(async()=>result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1','edit-2']}));expect(result.current.notes[0].status).toBe('resolved');
});

it('refuses a batch exceeding the existing Assist intent limit while retaining notes',async()=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version})); await act(async () => {});
  await act(async()=>await result.current.add(first,'x'.repeat(10_000)));const ids=result.current.notes.map(n=>n.id);
  await act(async()=>{expect(result.current.dispatch(ids)).toBe(false);});expect(result.current.assistRequest).toBeNull();expect(result.current.notes[0].status).toBe('pending');expect(result.current.conflict).toBe(true);
});

it.each([
  {label:'same line',base:'one and two',next:'ONE and two',one:[0,3],two:[8,11]},
  {label:'indivisible long edit',base:'one\n'+'keep\n'.repeat(301)+'two',next:'ONE\n'+'keep\n'.repeat(301)+'two',one:[0,3],two:[1509,1512]},
])('does not resolve retained note passages in $label',async ({base,next,one,two})=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:base,updatedAt:version})); await act(async () => {});
  await act(async()=>{await result.current.add(captureAssistTarget(base,'selection',one[0],one[1],version)!,'change one');await result.current.add(captureAssistTarget(base,'selection',two[0],two[1],version)!,'change two');});
  const ids=result.current.notes.map(n=>n.id);await act(async()=>{result.current.dispatch(ids);});
  const done=completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:base,baseUpdatedAt:version,assistTarget:result.current.assistRequest?.assistTarget,noteIds:ids,content:'',status:'generating'},next);
  await act(async()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','awaiting-review']);
});

it.each([
  {label:'interior insertion',base:'one and two',next:'o!ne and two',one:[0,3],two:[8,11]},
  {label:'deletion',base:'one and two',next:' and two',one:[0,3],two:[8,11]},
  {label:'unchanged middle quote',base:'one and two and three',next:'ONE and two and THREE',one:[0,3],two:[8,11]},
])('requires source-change evidence for notes when accepting $label',async ({base,next,one,two})=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:base,updatedAt:version})); await act(async () => {});
  await act(async()=>{await result.current.add(captureAssistTarget(base,'selection',one[0],one[1],version)!,'change one');await result.current.add(captureAssistTarget(base,'selection',two[0],two[1],version)!,'change two');});
  const ids=result.current.notes.map(n=>n.id);await act(async()=>{result.current.dispatch(ids);});
  const done=completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:base,baseUpdatedAt:version,assistTarget:captureAssistTarget(base,'document',0,base.length,version)!,noteIds:ids,content:'',status:'generating'},next);
  await act(async()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','awaiting-review']);
});

it('retains uncertain multi-hunk dependencies instead of resolving after only the definite hunk',async()=>{
  const base='one\nkeep\ntwo';
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:base,updatedAt:version})); await act(async () => {});
  await act(async()=>await result.current.add(captureAssistTarget(base,'selection',0,12,version)!,'Fix the whole passage'));
  const ids=result.current.notes.map(n=>n.id);await act(async()=>{result.current.dispatch(ids);});
  const done=completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:base,baseUpdatedAt:version,assistTarget:result.current.assistRequest?.assistTarget,noteIds:ids,content:'',status:'generating'},'ONE\nkeep\nnew two old');
  expect(done.editPlan?.edits).toHaveLength(2);
  await act(async()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes[0].status).toBe('awaiting-review');
  // Retained/uncertain correspondence cannot become positive evidence merely because all hunks were accepted.
  await act(async()=>result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1','edit-2']}));
  expect(result.current.notes[0].status).toBe('awaiting-review');
  await act(async()=>result.current.onNotesEvent({event:'discard',taskId:'task',noteIds:ids,candidate:done}));
  expect(result.current.notes[0].status).toBe('pending');
});

it('stages shared reader annotations without rewrite instructions or automatic Agent submission',async () => {
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: false, enabled: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  await act(async () => { expect(await result.current.add(first, 'Why this?')).toBe(true); });
  const id = result.current.notes[0].id;
  await act(async () => { expect(result.current.dispatch([id])).toBe(true); });
  expect(result.current.notes[0].status).toBe('pending');
  expect(result.current.assistRequest).toMatchObject({ autoSubmit: false, noteIds: [id], annotations: [{ id, body: 'Why this?', quote: 'one' }] });
  expect(result.current.assistRequest?.intent).not.toMatch(/rewrite|edit|modify/i);
});
it('recovers same-task note coverage on remount without resetting statuses or accepting another task',async () => {
  const firstHook = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  await act(async () => await firstHook.result.current.add(first, 'Fix one'));
  const id = firstHook.result.current.notes[0].id;
  await act(async () => { firstHook.result.current.dispatch([id]); });
  const done = candidate([id], firstHook.result.current.assistRequest?.assistTarget);
  await act(async () => firstHook.result.current.onNotesEvent({ event: 'dispatch', taskId: 'task', noteIds: [id], candidate: done }));
  firstHook.unmount();
  const secondHook = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  await act(async () => secondHook.result.current.onNotesEvent({ event: 'ready', taskId: 'other', noteIds: [id], candidate: { ...done, taskId: 'other' } }));
  expect(secondHook.result.current.notes[0].status).toBe('dispatched');
  await act(async () => secondHook.result.current.onNotesEvent({ event: 'ready', taskId: 'task', noteIds: [id], candidate: done }));
  expect(secondHook.result.current.notes[0].status).toBe('awaiting-review');
});

it.each(['valid', 'wrong old task', 'wrong user', 'wrong Space', 'wrong page', 'changed old annotation', 'wrong old selection', 'stale old version', 'unselected note', 'resolved note', 'ordinary dispatch'])('checks explicit regeneration ownership: %s', async (variant) => {
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  await act(async () => { await result.current.add(first, 'Fix one'); await result.current.add(second, 'Keep private'); });
  const [id, privateId] = result.current.notes.map((note) => note.id);
  await act(async () => { result.current.dispatch([id]); });
  const initial = result.current.assistRequest!;
  const old = completeAssistCandidate({ ...candidate([id], initial.assistTarget), status: 'generating' }, 'ONE\nkeep\ntwo\n');
  const initialProof = { ...scope, request: initial, snapshot: { title: 'T', content: source, updatedAt: version } };
  await act(async () => {
    result.current.onNotesEvent({ event: 'dispatch', taskId: 'task', noteIds: [id], candidate: old, dispatchRequest: initialProof, annotations: initial.annotations });
    result.current.onRequestHandled(initial.id);
    result.current.onNotesEvent({ event: 'ready', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
    if (variant === 'resolved note') result.current.onNotesEvent({ event: 'accept', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations, acceptedEditIds: ['edit-1'] });
  });
  const prior = result.current.notes[0].status;
  expect(prior).toBe(variant === 'resolved note' ? 'resolved' : 'awaiting-review');
  const next = { ...old, taskId: 'next' };
  const request = { ...initial, id: 'explicit-regeneration', supersedes: {
    taskId: 'task', snapshot: { title: 'T', content: source, updatedAt: version }, noteIds: [id], annotations: [{ id, body: 'Fix one', quote: 'one' }],
  } };
  const proof = { ...scope, request, snapshot: { title: 'T', content: source, updatedAt: version } };
  if (variant === 'wrong old task') request.supersedes.taskId = 'another-task';
  if (variant === 'wrong user') proof.userId = 'another-user';
  if (variant === 'wrong Space') proof.spaceId = 'another-space';
  if (variant === 'wrong page') proof.pageId = 'another-page';
  if (variant === 'changed old annotation') request.supersedes.annotations[0].body = 'different';
  if (variant === 'wrong old selection') request.supersedes.snapshot.content = 'missing original passage';
  if (variant === 'stale old version') request.supersedes.snapshot.updatedAt = 'stale';
  if (variant === 'unselected note') request.supersedes.noteIds = [privateId];
  if (variant === 'ordinary dispatch') delete (request as { supersedes?: unknown }).supersedes;
  await act(async () => result.current.onNotesEvent({ event: 'dispatch', taskId: 'next', noteIds: [id], candidate: next, dispatchRequest: proof, annotations: initial.annotations }));
  expect(result.current.notes[0]).toMatchObject({ status: variant === 'valid' ? 'dispatched' : prior, taskId: variant === 'valid' ? 'next' : 'task' });
  expect(result.current.notes[1]).toMatchObject({ status: 'pending' }); expect(result.current.notes[1].taskId).toBeUndefined();
  if (variant === 'valid') {
    await act(async () => {
      result.current.onNotesEvent({ event: 'ready', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
      result.current.onNotesEvent({ event: 'accept', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations, acceptedEditIds: ['edit-1'] });
      result.current.onNotesEvent({ event: 'fail', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
      result.current.onNotesEvent({ event: 'discard', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
    });
    expect(result.current.notes[0]).toMatchObject({ status: 'dispatched', taskId: 'next' });
  }
});

it.each(['valid', 'all resolved', 'wrong old task', 'missing note', 'changed resolved annotation', 'changed unresolved annotation', 'changed old annotation', 'changed old source', 'stale version', 'incomplete event', 'incomplete candidate', 'missing event proof', 'wrong scope'])('validates the entire mixed-note regeneration proof: %s', async (variant) => {
  const one = { ...addPersonalNote(scope, first, 'Fix one'), status: 'resolved' as const, taskId: 'historical-task' };
  const two = { ...addPersonalNote(scope, second, 'Fix two'), status: variant === 'all resolved' ? 'resolved' as const : 'awaiting-review' as const, taskId: 'task' };
  savePersonalNotes(scope, variant === 'missing note' ? [two] : [one, two]);
  const ids = [one.id, two.id], annotations = [{ id: one.id, body: one.body, quote: one.target.quote }, { id: two.id, body: two.body, quote: two.target.quote }];
  const target = captureAssistTarget(source, 'document', 0, source.length, version)!;
  const request: AssistRequest = { id: 'regenerate', intent: 'Fix both', assistTarget: target, noteIds: ids, annotations,
    supersedes: { taskId: 'task', snapshot: { title: 'T', content: source, updatedAt: version }, noteIds: ids, annotations: structuredClone(annotations) } };
  const next = { ...candidate(ids, target), taskId: 'next' };
  const event: AssistNotesEvent = { event: 'dispatch', taskId: 'next', noteIds: ids, candidate: next, annotations: structuredClone(annotations),
    dispatchRequest: { ...scope, request, snapshot: { title: 'T', content: source, updatedAt: version } } };
  if (variant === 'wrong old task') request.supersedes!.taskId = 'wrong-task';
  if (variant === 'changed resolved annotation') event.annotations![0].body = 'tampered';
  if (variant === 'changed unresolved annotation') event.annotations![1].quote = 'tampered';
  if (variant === 'changed old annotation') request.supersedes!.annotations[0].body = 'tampered';
  if (variant === 'changed old source') request.supersedes!.snapshot = { ...request.supersedes!.snapshot, content: 'missing anchors' };
  if (variant === 'stale version') next.baseUpdatedAt = 'stale';
  if (variant === 'incomplete event') event.noteIds = [two.id];
  if (variant === 'incomplete candidate') next.noteIds = [two.id];
  if (variant === 'missing event proof') event.annotations = undefined;
  if (variant === 'wrong scope') event.dispatchRequest!.userId = 'other';
  const hook = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  const before = structuredClone(hook.result.current.notes);
  await act(async () => hook.result.current.onNotesEvent(event));
  if (variant !== 'valid') { expect(hook.result.current.notes).toEqual(before); return; }
  expect(hook.result.current.notes).toMatchObject([one, { ...two, status: 'dispatched', taskId: 'next' }]);
  // Old callbacks must not reopen or resolve the newly bound note, even with a complete mixed set.
  for (const oldEvent of ['ready', 'accept', 'fail', 'discard'] as const) await act(async () => hook.result.current.onNotesEvent({ event: oldEvent, taskId: 'task', noteIds: ids, candidate: { ...next, taskId: 'task' }, annotations, acceptedEditIds: ['edit-1', 'edit-2'] }));
  expect(hook.result.current.notes).toMatchObject([one, { ...two, status: 'dispatched', taskId: 'next' }]);
  hook.unmount();
  const restored = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  await act(async () => restored.result.current.onNotesEvent({ event: 'ready', taskId: 'next', noteIds: ids, candidate: next, annotations }));
  expect(restored.result.current.notes).toMatchObject([one, { ...two, status: 'awaiting-review', taskId: 'next' }]);
  await act(async () => restored.result.current.onNotesEvent({ event: 'accept', taskId: 'next', noteIds: ids, candidate: next, annotations, acceptedEditIds: ['edit-1'] }));
  expect(restored.result.current.notes).toMatchObject([one, { ...two, status: 'awaiting-review', taskId: 'next' }]);
  await act(async () => restored.result.current.onNotesEvent({ event: 'accept', taskId: 'next', noteIds: ids, candidate: next, annotations, acceptedEditIds: ['edit-1', 'edit-2'] }));
  expect(restored.result.current.notes).toMatchObject([one, { ...two, status: 'resolved', taskId: 'next' }]);
});

it.each(['valid', 'changed resolved body', 'changed unresolved quote', 'missing annotations', 'incomplete event', 'incomplete candidate', 'missing note', 'wrong unresolved task', 'stale version', 'changed source', 'wrong page'])('recovers mixed-note coverage only with complete canonical evidence: %s', async (variant) => {
  const one = { ...addPersonalNote(scope, first, 'Fix one'), status: 'resolved' as const, taskId: 'historical-task' };
  const two = { ...addPersonalNote(scope, second, 'Fix two'), status: 'dispatched' as const, taskId: variant === 'wrong unresolved task' ? 'wrong-task' : 'next' };
  savePersonalNotes(scope, variant === 'missing note' ? [two] : [one, two]);
  const ids = [one.id, two.id], annotations = [{ id: one.id, body: one.body, quote: one.target.quote }, { id: two.id, body: two.body, quote: two.target.quote }];
  const next = { ...candidate(ids, captureAssistTarget(source, 'document', 0, source.length, version)!), taskId: 'next' };
  const event: AssistNotesEvent = { event: 'ready', taskId: 'next', noteIds: ids, candidate: next, annotations };
  if (variant === 'changed resolved body') annotations[0].body = 'tampered';
  if (variant === 'changed unresolved quote') annotations[1].quote = 'tampered';
  if (variant === 'missing annotations') event.annotations = undefined;
  if (variant === 'incomplete event') event.noteIds = [two.id];
  if (variant === 'incomplete candidate') next.noteIds = [two.id];
  if (variant === 'stale version') next.baseUpdatedAt = 'stale';
  if (variant === 'changed source') next.baseContent = 'missing anchors';
  if (variant === 'wrong page') next.pageId = 'other';
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  const before = structuredClone(result.current.notes);
  await act(async () => { result.current.onNotesEvent(event); result.current.onNotesEvent({ ...event, event: 'accept', acceptedEditIds: ['edit-1', 'edit-2'] }); });
  expect(result.current.notes).toMatchObject(variant === 'valid' ? [one, { ...two, status: 'resolved' }] : before);
});


it('loads all page authors while preserving author-only mutations and Agent dispatch context', async () => {
  const own = serverNote(addPersonalNote(scope, first, 'Alice note', 'alice'));
  const other = serverNote(addPersonalNote({ ...scope, userId: 'bob' }, second, 'Bob note', 'bob'));
  const bot = { ...serverNote(addPersonalNote({ ...scope, userId: 'agent:bot' }, first, 'Agent note', 'bot')), author: { type: 'agent' as const, id: 'bot', name: 'Research Agent' } };
  server = [own, other, bot];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: false, enabled: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  expect(result.current.notes.map((note) => note.author?.name)).toEqual(['u', 'bob', 'Research Agent']);
  expect(result.current.notes.map((note) => note.canEdit)).toEqual([true, false, false]);
  await act(async () => { result.current.reopen(other.id); expect(result.current.dispatch([other.id, bot.id])).toBe(true); });
  expect(pageNotesApi.update).not.toHaveBeenCalled();
  expect(result.current.assistRequest).toMatchObject({ autoSubmit: false, noteIds: ['bob', 'bot'] });
});

it('migrates only the current account scope, retains failures, and retries with the same idempotency key', async () => {
  const legacy = addPersonalNote(scope, first, 'Legacy note', 'legacy');
  const otherScope = { ...scope, userId: 'other' };
  savePersonalNotes(scope, [legacy]); savePersonalNotes(otherScope, [addPersonalNote(otherScope, second, 'Not yours', 'other')]);
  vi.mocked(pageNotesApi.create).mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  expect(result.current.notes).toMatchObject([{ id: 'legacy', syncState: 'unsynced' }]);
  expect(result.current.storageUnavailable).toBe(true);
  expect(JSON.parse(localStorage.getItem(personalNotesKey(scope))!)).toHaveLength(1);
  await act(async () => { expect(result.current.dispatch(['legacy'])).toBe(false); await result.current.retrySync(); });
  expect(result.current.notes).toMatchObject([{ id: 'legacy', author: { id: 'u' }, clientNoteId: 'legacy' }]);
  expect(result.current.notes[0].syncState).toBeUndefined();
  expect(JSON.parse(localStorage.getItem(personalNotesKey(scope))!)).toEqual([]);
  expect(JSON.parse(localStorage.getItem(personalNotesKey(otherScope))!)).toHaveLength(1);
  expect(vi.mocked(pageNotesApi.create).mock.calls.map((call) => call[1].clientNoteId)).toEqual(['legacy', 'legacy']);
});

it('discards an old account response and aborts its pending request without creating a false success', async () => {
  let finish!: (note: PersonalNote) => void;
  vi.mocked(pageNotesApi.create).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook((props) => usePersonalNotes(props), { initialProps: { scope, canEdit: true, source, updatedAt: version } }); await act(async () => {});
  let saving!: Promise<boolean>;
  await act(async () => { saving = result.current.add(first, 'Alice draft'); });
  const signal = vi.mocked(pageNotesApi.create).mock.calls[0][2];
  rerender({ scope: { ...scope, userId: 'bob' }, canEdit: true, source, updatedAt: version });
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(serverNote(addPersonalNote(scope, first, 'Alice draft', 'late'))); expect(await saving).toBe(false); });
  expect(result.current.notes).toEqual([]); expect(result.current.assistRequest).toBeNull();
});

it('refreshes other members notes on focus but never overwrites an unconfirmed status transition', async () => {
  server = [serverNote(addPersonalNote(scope, first, 'Own', 'own'))];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  server.push(serverNote(addPersonalNote({ ...scope, userId: 'bob' }, second, 'New note', 'new')));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(result.current.notes).toHaveLength(2);
  let finish!: (note: PersonalNote) => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { result.current.dispatch(['own']); result.current.onNotesEvent({ event: 'dispatch', taskId: 'task', noteIds: ['own'], candidate: candidate(['own'], result.current.assistRequest?.assistTarget) }); });
  const reads = vi.mocked(pageNotesApi.list).mock.calls.length;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(pageNotesApi.list).toHaveBeenCalledTimes(reads); expect(result.current.notes[0].status).toBe('dispatched');
  await act(async () => { finish({ ...server[0], status: 'dispatched', taskId: 'task', updatedAt: 'confirmed' }); });
  expect(result.current.syncing).toBe(false);
});

it('rolls a rejected state mutation back to the last server receipt and exposes retry feedback', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  vi.mocked(pageNotesApi.update).mockRejectedValueOnce(new Error('conflict'));
  await act(async () => { result.current.reopen('own'); });
  expect(result.current.notes[0].status).toBe('resolved'); expect(result.current.storageUnavailable).toBe(true);
});

it('maps migrated historical receipt IDs only for the current human author', async () => {
  const own = { ...serverNote(addPersonalNote(scope, first, 'Fix one', 'server-own')), clientNoteId: 'legacy-own', status: 'dispatched' as const, taskId: 'task' };
  server = [own];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  const done = candidate(['legacy-own'], first);
  await act(async () => { result.current.onNotesEvent({ event: 'ready', taskId: 'task', noteIds: ['legacy-own'], candidate: done }); });
  expect(result.current.notes[0]).toMatchObject({ id: 'server-own', status: 'awaiting-review' });
  expect(pageNotesApi.update).toHaveBeenCalledWith(scope, 'server-own', expect.anything(), expect.any(AbortSignal));
});


it('hides previously loaded notes when page access is revoked', async () => {
  server = [serverNote(addPersonalNote(scope, first, 'Own', 'own'))];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  expect(result.current.notes).toHaveLength(1);
  vi.mocked(pageNotesApi.list).mockRejectedValueOnce({ response: { status: 403 } });
  await act(async () => { await result.current.retrySync(); });
  expect(result.current.notes).toEqual([]); expect(result.current.canCreate).toBe(false); expect(result.current.assistRequest).toBeNull();
});

it('ignores a superseded refresh so a slower old list cannot erase newer collaborators notes', async () => {
  let finish!: (value: { notes: PersonalNote[]; canCreate: boolean }) => void;
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  vi.mocked(pageNotesApi.list).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  server.push(serverNote(addPersonalNote(scope, first, 'Newer', 'newer')));
  await act(async () => { await result.current.retrySync(); });
  await act(async () => { finish({ notes: [], canCreate: true }); });
  expect(result.current.notes).toMatchObject([{ id: 'newer' }]);
});


it.each([401, 403, 404])('fences all pending creates after a %s write rejection until a fresh authorized read', async (status) => {
  server = [serverNote(addPersonalNote(scope, first, 'Existing', 'existing'))];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  let finish!: (note: PersonalNote) => void, pending!: Promise<boolean>;
  vi.mocked(pageNotesApi.create).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { pending = result.current.add(first, 'Slow save'); });
  const signal = vi.mocked(pageNotesApi.create).mock.calls[0][2];
  vi.mocked(pageNotesApi.create).mockRejectedValueOnce({ response: { status } });
  await act(async () => { expect(await result.current.add(second, 'Denied save')).toBe(false); });
  expect(signal?.aborted).toBe(true);
  expect(result.current).toMatchObject({ notes: [], canCreate: false, syncing: false, assistRequest: null });
  await act(async () => { finish(serverNote(addPersonalNote(scope, first, 'Slow save', 'late'))); expect(await pending).toBe(false); });
  expect(result.current.notes).toEqual([]);
  await act(async () => { expect(await result.current.add(first, 'Still denied')).toBe(false); });
  expect(pageNotesApi.create).toHaveBeenCalledTimes(2);
  await act(async () => { await result.current.retrySync(); });
  expect(result.current).toMatchObject({ canCreate: true, notes: [{ id: 'existing' }] });
  await act(async () => { expect(await result.current.add(first, 'Authorized again')).toBe(true); });
});

it.each([401, 403, 404])('stops queued status changes when the first PATCH returns %s', async (status) => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  let reject!: (error: unknown) => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce(() => new Promise((_, failure) => { reject = failure; }));
  await act(async () => { result.current.reopen('own'); result.current.reopen('own'); });
  expect(pageNotesApi.update).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(pageNotesApi.update).mock.calls[0][3];
  await act(async () => { reject({ response: { status } }); });
  expect(signal?.aborted).toBe(true);
  expect(pageNotesApi.update).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({ notes: [], canCreate: false, syncing: false, assistRequest: null });
});

it.each([401, 403, 404])('stops legacy migration on %s and never resurfaces legacy data after a failed retry', async (status) => {
  const legacy = [addPersonalNote(scope, first, 'One', 'one'), addPersonalNote(scope, second, 'Two', 'two')];
  savePersonalNotes(scope, legacy);
  vi.mocked(pageNotesApi.create).mockRejectedValueOnce({ response: { status } });
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  expect(pageNotesApi.create).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({ notes: [], canCreate: false, syncing: false });
  expect(JSON.parse(localStorage.getItem(personalNotesKey(scope))!)).toEqual(legacy);
  vi.mocked(pageNotesApi.list).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await result.current.retrySync(); });
  expect(result.current.notes).toEqual([]);
  expect(pageNotesApi.create).toHaveBeenCalledTimes(1);
});

it('applies a GET access denial even if a create started after the read', async () => {
  server = [serverNote(addPersonalNote(scope, first, 'Existing', 'existing'))];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  let reject!: (error: unknown) => void, finish!: (note: PersonalNote) => void, pending!: Promise<boolean>;
  vi.mocked(pageNotesApi.list).mockImplementationOnce(() => new Promise((_, failure) => { reject = failure; }));
  await act(async () => { void result.current.retrySync(); });
  vi.mocked(pageNotesApi.create).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { pending = result.current.add(first, 'Slow save'); });
  await act(async () => { reject({ response: { status: 403 } }); });
  expect(result.current).toMatchObject({ notes: [], canCreate: false, syncing: false });
  await act(async () => { finish(serverNote(addPersonalNote(scope, first, 'Slow save', 'late'))); expect(await pending).toBe(false); });
  expect(result.current.notes).toEqual([]);
});


it('keeps pre-revocation actions and Agent receipts fenced after access is restored', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'dispatched', taskId: 'task' }];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version })); await act(async () => {});
  const oldAdd = result.current.add, oldEvent = result.current.onNotesEvent, oldReopen = result.current.reopen;
  vi.mocked(pageNotesApi.list).mockRejectedValueOnce({ response: { status: 403 } });
  await act(async () => { await result.current.retrySync(); });
  await act(async () => { await result.current.retrySync(); });
  expect(result.current.notes[0].status).toBe('dispatched');
  const event: AssistNotesEvent = { event: 'ready', taskId: 'task', noteIds: ['own'], candidate: candidate(['own'], first) };
  await act(async () => { oldEvent(event); oldReopen('own'); expect(await oldAdd(first, 'Old invocation')).toBe(false); });
  expect(pageNotesApi.update).not.toHaveBeenCalled();
  expect(pageNotesApi.create).not.toHaveBeenCalled();
  expect(result.current.notes[0].status).toBe('dispatched');
  await act(async () => { result.current.onNotesEvent(event); });
  expect(result.current.notes[0].status).toBe('awaiting-review');
});


it.each(['page', 'space'])('finishes an authorized status PATCH across an in-place %s change and waits before reading it again', async (boundary) => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const props = { scope, canEdit: true, source, updatedAt: version };
  const { result, rerender } = renderHook((input) => usePersonalNotes(input), { initialProps: props }); await act(async () => {});
  const update = vi.mocked(pageNotesApi.update).getMockImplementation()!;
  let finish!: () => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce((...args) => new Promise((resolve, reject) => { finish = () => { void update(...args).then(resolve, reject); }; }));
  await act(async () => { result.current.reopen('own'); });
  const signal = vi.mocked(pageNotesApi.update).mock.calls[0][3];
  rerender({ ...props, scope: { ...scope, [boundary === 'page' ? 'pageId' : 'spaceId']: 'other' } }); await act(async () => {});
  expect(signal?.aborted).toBe(false); expect(result.current.notes).toEqual([]);
  const reads = vi.mocked(pageNotesApi.list).mock.calls.length;
  rerender(props); await act(async () => {});
  expect(result.current.loaded).toBe(false); expect(pageNotesApi.list).toHaveBeenCalledTimes(reads);
  await act(async () => { finish(); });
  expect(result.current).toMatchObject({ loaded: true, notes: [{ id: 'own', status: 'pending' }] });
  expect(server[0]).toMatchObject({ status: 'pending', taskId: undefined });
  expect(pageNotesApi.update).toHaveBeenCalledWith(scope, 'own', expect.anything(), expect.any(AbortSignal));
});

it('continues all already queued status writes after unmount using their original confirmed versions', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const props = { scope, canEdit: true, source, updatedAt: version };
  const old = renderHook(() => usePersonalNotes(props)); await act(async () => {});
  const update = vi.mocked(pageNotesApi.update).getMockImplementation()!;
  let finish!: () => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce((...args) => new Promise((resolve, reject) => { finish = () => { void update(...args).then(resolve, reject); }; }));
  await act(async () => { old.result.current.reopen('own'); old.result.current.reopen('own'); });
  old.unmount();
  const next = renderHook(() => usePersonalNotes(props)); await act(async () => {});
  expect(next.result.current.loaded).toBe(false);
  await act(async () => { finish(); });
  expect(pageNotesApi.update).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(pageNotesApi.update).mock.calls;
  expect(calls[0][2].expectedUpdatedAt).not.toBe(calls[1][2].expectedUpdatedAt);
  expect(next.result.current).toMatchObject({ loaded: true, syncing: false, notes: [{ id: 'own', status: 'pending' }] });
});

it.each(['account', 'token'])('cancels an unmounted write lane after a %s change without lending it the new identity', async (boundary) => {
  localStorage.setItem('token', 'first-test-session');
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const props = { scope, canEdit: true, source, updatedAt: version };
  const old = renderHook(() => usePersonalNotes(props)); await act(async () => {});
  let finish!: (value: PersonalNote) => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { old.result.current.reopen('own'); old.result.current.reopen('own'); });
  const signal = vi.mocked(pageNotesApi.update).mock.calls[0][3];
  old.unmount();
  if (boundary === 'token') localStorage.setItem('token', 'second-test-session');
  const next = renderHook(() => usePersonalNotes({ ...props, scope: boundary === 'account' ? { ...scope, userId: 'bob' } : scope })); await act(async () => {});
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ ...server[0], status: 'pending' }); });
  expect(pageNotesApi.update).toHaveBeenCalledTimes(1);
  expect(next.result.current.notes[0].status).toBe('resolved');
});

it('releases the route read barrier after an old status request fails', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const props = { scope, canEdit: true, source, updatedAt: version };
  const old = renderHook(() => usePersonalNotes(props)); await act(async () => {});
  let reject!: (error: unknown) => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce(() => new Promise((_, failure) => { reject = failure; }));
  await act(async () => { old.result.current.reopen('own'); }); old.unmount();
  const next = renderHook(() => usePersonalNotes(props)); await act(async () => {});
  expect(next.result.current.loaded).toBe(false);
  await act(async () => { reject(new Error('timeout')); });
  expect(next.result.current).toMatchObject({ loaded: true, notes: [{ id: 'own', status: 'resolved' }] });
});


it('does not treat the next route loading without a page scope as an authorization revocation', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Own', 'own')), status: 'resolved', taskId: 'task' }];
  const props = { scope: scope as typeof scope | null, canEdit: true, enabled: true, source, updatedAt: version };
  const old = renderHook((input) => usePersonalNotes(input), { initialProps: props }); await act(async () => {});
  const update = vi.mocked(pageNotesApi.update).getMockImplementation()!;
  let finish!: () => void;
  vi.mocked(pageNotesApi.update).mockImplementationOnce((...args) => new Promise((resolve, reject) => { finish = () => { void update(...args).then(resolve, reject); }; }));
  await act(async () => { old.result.current.reopen('own'); });
  const signal = vi.mocked(pageNotesApi.update).mock.calls[0][3];
  old.rerender({ ...props, scope: null, enabled: false });
  expect(signal?.aborted).toBe(false); old.unmount();
  const next = renderHook((input) => usePersonalNotes(input), { initialProps: { ...props, scope: null, enabled: false } as typeof props });
  expect(signal?.aborted).toBe(false);
  next.rerender(props); await act(async () => {});
  expect(next.result.current.loaded).toBe(false);
  await act(async () => { finish(); });
  expect(next.result.current).toMatchObject({ loaded: true, notes: [{ id: 'own', status: 'pending' }] });
});


it('adds a newly confirmed note to an existing write lane before dispatching it while another PATCH is pending', async () => {
  server = [{ ...serverNote(addPersonalNote(scope, first, 'Existing note', 'existing')), status: 'awaiting-review', taskId: 'old-task' }];
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version })); await act(async () => {});
  const create = vi.mocked(pageNotesApi.create).getMockImplementation()!, update = vi.mocked(pageNotesApi.update).getMockImplementation()!;
  let finishCreate!: () => void, finishPatch!: () => void, adding!: Promise<boolean>;
  vi.mocked(pageNotesApi.create).mockImplementationOnce((...args) => new Promise((resolve, reject) => { finishCreate = () => { void create(...args).then(resolve, reject); }; }));
  await act(async () => { adding = result.current.add(second, 'New note'); });
  vi.mocked(pageNotesApi.update).mockImplementationOnce((...args) => new Promise((resolve, reject) => { finishPatch = () => { void update(...args).then(resolve, reject); }; }));
  await act(async () => { result.current.reopen('existing'); });
  expect(pageNotesApi.update).toHaveBeenCalledTimes(1);
  await act(async () => { finishCreate(); expect(await adding).toBe(true); });
  const added = result.current.notes.find((note) => note.body === 'New note')!;
  expect(result.current.syncing).toBe(true);
  await act(async () => { expect(result.current.dispatch([added.id])).toBe(true); });
  const request = result.current.assistRequest!;
  await act(async () => { result.current.onNotesEvent({ event: 'dispatch', taskId: 'task', noteIds: [added.id], candidate: candidate([added.id], request.assistTarget), dispatchRequest: { ...scope, request, snapshot: { title: 'T', content: source, updatedAt: version } }, annotations: request.annotations }); });
  expect(result.current.notes.find((note) => note.id === added.id)).toMatchObject({ status: 'dispatched', taskId: 'task' });
  expect(pageNotesApi.update).toHaveBeenCalledTimes(1);
  await act(async () => { finishPatch(); });
  expect(pageNotesApi.update).toHaveBeenCalledTimes(2);
  expect(vi.mocked(pageNotesApi.update).mock.calls[1]).toEqual([scope, added.id, { expectedUpdatedAt: added.updatedAt, status: 'dispatched', taskId: 'task' }, expect.any(AbortSignal)]);
  expect(server.find((note) => note.id === added.id)).toMatchObject({ status: 'dispatched', taskId: 'task' });
  expect(result.current.syncing).toBe(false);
});
