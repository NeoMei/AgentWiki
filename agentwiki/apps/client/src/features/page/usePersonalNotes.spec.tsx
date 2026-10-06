import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePersonalNotes } from './usePersonalNotes';
import { captureAssistTarget } from './assistTargets';
import { completeAssistCandidate, type AssistCandidate } from './assistCandidate';
import { addPersonalNote, personalNotesKey, savePersonalNotes } from './reviewComments';
import type { AssistNotesEvent, AssistRequest } from './AgentAssistPanel';
const scope={userId:'u',spaceId:'s',pageId:'p'}, version='2026-10-06T00:00:00Z', source='one\nkeep\ntwo\n';
const first=captureAssistTarget(source,'selection',0,3,version)!, second=captureAssistTarget(source,'selection',9,12,version)!;
const candidate=(ids:string[], target:any):AssistCandidate=>completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:source,baseUpdatedAt:version,assistTarget:target,noteIds:ids,content:'',status:'generating'},'ONE\nkeep\nTWO\n');
beforeEach(()=>localStorage.clear());afterEach(cleanup);
describe('scoped personal notes controller',()=>{
  it('persists notes, dispatches a bounded anchored batch, and only resolves accepted covered changes',()=>{
    const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version,language:'en'}));
    act(()=>{result.current.add(first,'Fix one');result.current.add(second,'Fix two');});
    const ids=result.current.notes.map(n=>n.id);
    act(()=>{expect(result.current.dispatch(ids)).toBe(true);});
    const request=result.current.assistRequest!;
    expect(request).toMatchObject({noteIds:ids,assistTarget:{from:0,to:12,quote:'one\nkeep\ntwo'}});
    expect(request.intent).toContain('Fix one');expect(request.intent).toContain('"quote":"two"');
    const done=candidate(ids,request.assistTarget);
    act(()=>result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['dispatched','dispatched']);
    act(()=>result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['awaiting-review','awaiting-review']);
    act(()=>result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:{...done,acceptedEditIds:['edit-1']},editId:'edit-1',acceptedEditIds:['edit-1']}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','awaiting-review']);
    act(()=>result.current.onNotesEvent({event:'discard',taskId:'task',noteIds:ids,candidate:done}));
    expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','pending']);
    expect(JSON.parse(localStorage.getItem(personalNotesKey(scope))!).map((n:any)=>n.status)).toEqual(['resolved','pending']);
  });
  it('clears visibility on account/permission changes and ignores delayed callbacks even after return',()=>{
    const {result,rerender}=renderHook((props)=>usePersonalNotes(props),{initialProps:{scope,canEdit:true,source,updatedAt:version}});
    act(()=>result.current.add(first,'private'));
    const oldAdd=result.current.add, oldEvent=result.current.onNotesEvent;
    const id=result.current.notes[0].id;act(()=>{result.current.dispatch([id]);});const done=candidate([id],result.current.assistRequest?.assistTarget);
    rerender({scope:{...scope,userId:'other'},canEdit:true,source,updatedAt:version});expect(result.current.notes).toEqual([]);
    act(()=>{oldAdd(first,'leak');oldEvent({event:'dispatch',taskId:'task',noteIds:[id],candidate:done});});expect(result.current.notes).toEqual([]);
    rerender({scope,canEdit:false,source,updatedAt:version});expect(result.current.notes).toEqual([]);expect(result.current.assistRequest).toBeNull();
    rerender({scope,canEdit:true,source,updatedAt:version});expect(result.current.notes[0].status).toBe('pending');
    act(()=>oldEvent({event:'dispatch',taskId:'task',noteIds:[id],candidate:done}));expect(result.current.notes[0].status).toBe('pending');
  });
  it('supports explicit reopen after reload and refuses orphan batch without losing quotes',()=>{
    const hook=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version}));
    act(()=>hook.result.current.add(first,'note'));const id=hook.result.current.notes[0].id;act(()=>{hook.result.current.dispatch([id]);});const done=candidate([id],hook.result.current.assistRequest?.assistTarget);
    act(()=>hook.result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:[id],candidate:done}));hook.unmount();
    const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:'changed',updatedAt:version}));
    expect(result.current.notes[0].status).toBe('dispatched');act(()=>result.current.reopen(id));expect(result.current.notes[0].status).toBe('pending');
    act(()=>{expect(result.current.dispatch([id])).toBe(false);});expect(result.current.notes[0].target.quote).toBe('one');expect(result.current.assistRequest).toBeNull();
  });
});

it('uses latest source/version for old UI callbacks and retains notes when persistence fails',()=>{
  const {result,rerender}=renderHook((props)=>usePersonalNotes(props),{initialProps:{scope,canEdit:true,source,updatedAt:version}});
  const oldAdd=result.current.add;
  rerender({scope,canEdit:true,source:'changed',updatedAt:version});
  act(()=>{expect(oldAdd(first,'stale')).toBe(false);});expect(result.current.notes).toEqual([]);
  rerender({scope,canEdit:true,source,updatedAt:version});
  const originalSet=Storage.prototype.setItem;
  Storage.prototype.setItem=()=>{throw new Error('quota');};
  try {act(()=>{expect(result.current.add(first,'keep in memory')).toBe(true);});expect(result.current.storageUnavailable).toBe(true);expect(result.current.notes[0].body).toBe('keep in memory');}
  finally {Storage.prototype.setItem=originalSet;}
});

it('keeps a note spanning multiple hunks awaiting review until all its changes are accepted',()=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version}));
  act(()=>result.current.add(captureAssistTarget(source,'selection',0,12,version)!,'Fix both'));
  const ids=result.current.notes.map(n=>n.id);act(()=>{result.current.dispatch(ids);});const done=candidate(ids,result.current.assistRequest?.assistTarget);
  act(()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes[0].status).toBe('awaiting-review');
  act(()=>result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1','edit-2']}));expect(result.current.notes[0].status).toBe('resolved');
});

it('refuses a batch exceeding the existing Assist intent limit while retaining notes',()=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source,updatedAt:version}));
  act(()=>result.current.add(first,'x'.repeat(10_000)));const ids=result.current.notes.map(n=>n.id);
  act(()=>{expect(result.current.dispatch(ids)).toBe(false);});expect(result.current.assistRequest).toBeNull();expect(result.current.notes[0].status).toBe('pending');expect(result.current.conflict).toBe(true);
});

it.each([
  {label:'same line',base:'one and two',next:'ONE and two',one:[0,3],two:[8,11]},
  {label:'indivisible long edit',base:'one\n'+'keep\n'.repeat(301)+'two',next:'ONE\n'+'keep\n'.repeat(301)+'two',one:[0,3],two:[1509,1512]},
])('does not resolve retained note passages in $label',({base,next,one,two})=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:base,updatedAt:version}));
  act(()=>{result.current.add(captureAssistTarget(base,'selection',one[0],one[1],version)!,'change one');result.current.add(captureAssistTarget(base,'selection',two[0],two[1],version)!,'change two');});
  const ids=result.current.notes.map(n=>n.id);act(()=>{result.current.dispatch(ids);});
  const done=completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:base,baseUpdatedAt:version,assistTarget:result.current.assistRequest?.assistTarget,noteIds:ids,content:'',status:'generating'},next);
  act(()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','awaiting-review']);
});

it.each([
  {label:'interior insertion',base:'one and two',next:'o!ne and two',one:[0,3],two:[8,11]},
  {label:'deletion',base:'one and two',next:' and two',one:[0,3],two:[8,11]},
  {label:'unchanged middle quote',base:'one and two and three',next:'ONE and two and THREE',one:[0,3],two:[8,11]},
])('requires source-change evidence for notes when accepting $label',({base,next,one,two})=>{
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:base,updatedAt:version}));
  act(()=>{result.current.add(captureAssistTarget(base,'selection',one[0],one[1],version)!,'change one');result.current.add(captureAssistTarget(base,'selection',two[0],two[1],version)!,'change two');});
  const ids=result.current.notes.map(n=>n.id);act(()=>{result.current.dispatch(ids);});
  const done=completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:base,baseUpdatedAt:version,assistTarget:captureAssistTarget(base,'document',0,base.length,version)!,noteIds:ids,content:'',status:'generating'},next);
  act(()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes.map(n=>n.status)).toEqual(['resolved','awaiting-review']);
});

it('retains uncertain multi-hunk dependencies instead of resolving after only the definite hunk',()=>{
  const base='one\nkeep\ntwo';
  const {result}=renderHook(()=>usePersonalNotes({scope,canEdit:true,source:base,updatedAt:version}));
  act(()=>result.current.add(captureAssistTarget(base,'selection',0,12,version)!,'Fix the whole passage'));
  const ids=result.current.notes.map(n=>n.id);act(()=>{result.current.dispatch(ids);});
  const done=completeAssistCandidate({taskId:'task',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:base,baseUpdatedAt:version,assistTarget:result.current.assistRequest?.assistTarget,noteIds:ids,content:'',status:'generating'},'ONE\nkeep\nnew two old');
  expect(done.editPlan?.edits).toHaveLength(2);
  act(()=>{result.current.onNotesEvent({event:'dispatch',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'ready',taskId:'task',noteIds:ids,candidate:done});result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1']});});
  expect(result.current.notes[0].status).toBe('awaiting-review');
  // Retained/uncertain correspondence cannot become positive evidence merely because all hunks were accepted.
  act(()=>result.current.onNotesEvent({event:'accept',taskId:'task',noteIds:ids,candidate:done,acceptedEditIds:['edit-1','edit-2']}));
  expect(result.current.notes[0].status).toBe('awaiting-review');
  act(()=>result.current.onNotesEvent({event:'discard',taskId:'task',noteIds:ids,candidate:done}));
  expect(result.current.notes[0].status).toBe('pending');
});

it('stages private reader annotations without rewrite instructions, uploads, or status transitions', () => {
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: false, enabled: true, stageForSession: true, source, updatedAt: version }));
  act(() => { expect(result.current.add(first, 'Why this?')).toBe(true); });
  const id = result.current.notes[0].id;
  act(() => { expect(result.current.dispatch([id])).toBe(true); });
  expect(result.current.notes[0].status).toBe('pending');
  expect(result.current.assistRequest).toMatchObject({ autoSubmit: false, noteIds: [id], annotations: [{ id, body: 'Why this?', quote: 'one' }] });
  expect(result.current.assistRequest?.intent).not.toMatch(/rewrite|edit|modify/i);
});
it('recovers same-task note coverage on remount without resetting statuses or accepting another task', () => {
  const firstHook = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version }));
  act(() => firstHook.result.current.add(first, 'Fix one'));
  const id = firstHook.result.current.notes[0].id;
  act(() => { firstHook.result.current.dispatch([id]); });
  const done = candidate([id], firstHook.result.current.assistRequest?.assistTarget);
  act(() => firstHook.result.current.onNotesEvent({ event: 'dispatch', taskId: 'task', noteIds: [id], candidate: done }));
  firstHook.unmount();
  const secondHook = renderHook(() => usePersonalNotes({ scope, canEdit: true, source, updatedAt: version }));
  act(() => secondHook.result.current.onNotesEvent({ event: 'ready', taskId: 'other', noteIds: [id], candidate: { ...done, taskId: 'other' } }));
  expect(secondHook.result.current.notes[0].status).toBe('dispatched');
  act(() => secondHook.result.current.onNotesEvent({ event: 'ready', taskId: 'task', noteIds: [id], candidate: done }));
  expect(secondHook.result.current.notes[0].status).toBe('awaiting-review');
});

it.each(['valid', 'wrong old task', 'wrong user', 'wrong Space', 'wrong page', 'changed old annotation', 'wrong old selection', 'stale old version', 'unselected note', 'resolved note', 'ordinary dispatch'])('checks explicit regeneration ownership: %s', (variant) => {
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version }));
  act(() => { result.current.add(first, 'Fix one'); result.current.add(second, 'Keep private'); });
  const [id, privateId] = result.current.notes.map((note) => note.id);
  act(() => { result.current.dispatch([id]); });
  const initial = result.current.assistRequest!;
  const old = completeAssistCandidate({ ...candidate([id], initial.assistTarget), status: 'generating' }, 'ONE\nkeep\ntwo\n');
  const initialProof = { ...scope, request: initial, snapshot: { title: 'T', content: source, updatedAt: version } };
  act(() => {
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
  act(() => result.current.onNotesEvent({ event: 'dispatch', taskId: 'next', noteIds: [id], candidate: next, dispatchRequest: proof, annotations: initial.annotations }));
  expect(result.current.notes[0]).toMatchObject({ status: variant === 'valid' ? 'dispatched' : prior, taskId: variant === 'valid' ? 'next' : 'task' });
  expect(result.current.notes[1]).toMatchObject({ status: 'pending' }); expect(result.current.notes[1].taskId).toBeUndefined();
  if (variant === 'valid') {
    act(() => {
      result.current.onNotesEvent({ event: 'ready', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
      result.current.onNotesEvent({ event: 'accept', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations, acceptedEditIds: ['edit-1'] });
      result.current.onNotesEvent({ event: 'fail', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
      result.current.onNotesEvent({ event: 'discard', taskId: 'task', noteIds: [id], candidate: old, annotations: initial.annotations });
    });
    expect(result.current.notes[0]).toMatchObject({ status: 'dispatched', taskId: 'next' });
  }
});

it.each(['valid', 'all resolved', 'wrong old task', 'missing note', 'changed resolved annotation', 'changed unresolved annotation', 'changed old annotation', 'changed old source', 'stale version', 'incomplete event', 'incomplete candidate', 'missing event proof', 'wrong scope'])('validates the entire mixed-note regeneration proof: %s', (variant) => {
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
  const hook = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version }));
  const before = structuredClone(hook.result.current.notes);
  act(() => hook.result.current.onNotesEvent(event));
  if (variant !== 'valid') { expect(hook.result.current.notes).toEqual(before); return; }
  expect(hook.result.current.notes).toEqual([one, { ...two, status: 'dispatched', taskId: 'next' }]);
  // Old callbacks must not reopen or resolve the newly bound note, even with a complete mixed set.
  for (const oldEvent of ['ready', 'accept', 'fail', 'discard'] as const) act(() => hook.result.current.onNotesEvent({ event: oldEvent, taskId: 'task', noteIds: ids, candidate: { ...next, taskId: 'task' }, annotations, acceptedEditIds: ['edit-1', 'edit-2'] }));
  expect(hook.result.current.notes).toEqual([one, { ...two, status: 'dispatched', taskId: 'next' }]);
  hook.unmount();
  const restored = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version }));
  act(() => restored.result.current.onNotesEvent({ event: 'ready', taskId: 'next', noteIds: ids, candidate: next, annotations }));
  expect(restored.result.current.notes).toEqual([one, { ...two, status: 'awaiting-review', taskId: 'next' }]);
  act(() => restored.result.current.onNotesEvent({ event: 'accept', taskId: 'next', noteIds: ids, candidate: next, annotations, acceptedEditIds: ['edit-1'] }));
  expect(restored.result.current.notes).toEqual([one, { ...two, status: 'awaiting-review', taskId: 'next' }]);
  act(() => restored.result.current.onNotesEvent({ event: 'accept', taskId: 'next', noteIds: ids, candidate: next, annotations, acceptedEditIds: ['edit-1', 'edit-2'] }));
  expect(restored.result.current.notes).toEqual([one, { ...two, status: 'resolved', taskId: 'next' }]);
});

it.each(['valid', 'changed resolved body', 'changed unresolved quote', 'missing annotations', 'incomplete event', 'incomplete candidate', 'missing note', 'wrong unresolved task', 'stale version', 'changed source', 'wrong page'])('recovers mixed-note coverage only with complete canonical evidence: %s', (variant) => {
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
  const { result } = renderHook(() => usePersonalNotes({ scope, canEdit: true, stageForSession: true, source, updatedAt: version }));
  const before = structuredClone(result.current.notes);
  act(() => { result.current.onNotesEvent(event); result.current.onNotesEvent({ ...event, event: 'accept', acceptedEditIds: ['edit-1', 'edit-2'] }); });
  expect(result.current.notes).toEqual(variant === 'valid' ? [one, { ...two, status: 'resolved' }] : before);
});
