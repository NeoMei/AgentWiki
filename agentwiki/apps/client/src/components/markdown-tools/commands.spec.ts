import { EditorState, EditorSelection } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';
import { describe, it, expect } from 'vitest';
import { formatTransaction, insertionTransaction, pageLinkTransaction, slashRange } from './commands';
const stateFor = (doc:string, from:number, to=from) => EditorState.create({doc, selection:EditorSelection.single(from,to),extensions:[history()]});
describe('manual Markdown command transactions', () => {
  it.each([['bold','**中文**段落'],['italic','*中文*段落'],['code','`中文`段落']] as const)('wraps selection with %s preserving unrelated source and one undo', (command,want) => {
    let state = stateFor('中文段落',0,2);
    state = state.update(formatTransaction(state,command)).state;
    expect(state.doc.toString()).toBe(want);
    expect(state.sliceDoc(state.selection.main.from,state.selection.main.to)).toBe('中文');
    expect(undoDepth(state)).toBe(1);
    undo({state, dispatch:(transaction) => {state=transaction.state;}});
    expect(state.doc.toString()).toBe('中文段落');
  });
  it('keeps empty-selection caret inside markers and isolates prior typing', () => {
    let state=stateFor('Before',6);
    state=state.update({changes:{from:6,insert:' human'},selection:{anchor:12}}).state;
    state=state.update(formatTransaction(state,'bold')).state;
    expect(state.doc.toString()).toBe('Before human****');
    expect(state.selection.main.head).toBe(14);
    expect(undoDepth(state)).toBe(2);
    undo({state,dispatch:(transaction)=>{state=transaction.state;}});
    expect(state.doc.toString()).toBe('Before human');
  });
  it('uses longer code delimiter for selected backticks', () => {
    const state=stateFor('a`b',0,3);
    expect(state.update(formatTransaction(state,'code')).state.doc.toString()).toBe('``a`b``');
  });
  it('inserts link and selects destination while preserving label', () => {
    const state=stateFor('中文段落',0,2).update(formatTransaction(stateFor('中文段落',0,2),'link')).state;
    expect(state.doc.toString()).toBe('[中文](https://)段落');
    expect(state.sliceDoc(state.selection.main.from,state.selection.main.to)).toBe('https://');
  });
  it.each(['table','code'] as const)('replaces slash trigger with %s in one undo transaction', (command) => {
    let state=stateFor('Before\n/\nAfter',8);
    state=state.update(insertionTransaction(state,command,7)).state;
    expect(state.doc.toString()).not.toContain('\n/\n');
    expect(state.doc.toString()).toContain(command==='table' ? '| Column 1 | Column 2 |' : '```');
    expect(state.doc.toString()).toMatch(/^Before\n[\s\S]+\nAfter$/);
    expect(undoDepth(state)).toBe(1);
    undo({state,dispatch:(transaction)=>{state=transaction.state;}});
    expect(state.doc.toString()).toBe('Before\n/\nAfter');
  });
  it('inserts duplicate page titles by identity with safe display text', () => {
    const state=stateFor('hello',0,5);
    expect(state.update(pageLinkTransaction(state,{id:'page-b',title:'Same ] | title'})).state.doc.toString()).toBe('[[page-b|Same title]]');
  });
  it('opens slash at line start only, excluding IME and code fences', () => {
    expect(slashRange(stateFor('/ta',3),false)).toEqual({from:0,to:3,query:'ta'});
    expect(slashRange(stateFor('/ta',3),true)).toBeNull();
    expect(slashRange(stateFor('text /',6),false)).toBeNull();
    expect(slashRange(stateFor('```md\n/',7),false)).toBeNull();
  });
});
