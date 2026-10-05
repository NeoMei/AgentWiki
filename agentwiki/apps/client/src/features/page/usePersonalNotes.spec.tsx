import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePersonalNotes } from './usePersonalNotes';
import { captureAssistTarget } from './assistTargets';
import { completeAssistCandidate, type AssistCandidate } from './assistCandidate';
import { personalNotesKey } from './reviewComments';
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
