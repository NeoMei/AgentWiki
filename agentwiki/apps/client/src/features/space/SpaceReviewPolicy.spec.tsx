import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {LanguageProvider} from '../../context/LanguageContext';
import api from '../../api/client';
import {SpaceReviewPolicyCard, SpaceReviewPolicyStatus} from './SpaceReviewPolicy';
import {listenSpaceReviewPolicyChanges} from './spaceReviewPolicyEvents';
vi.mock('../../api/client',()=>({default:{patch:vi.fn()}}));
const card=(spaceId='space-a',actorId='owner',canEdit=true)=><LanguageProvider><SpaceReviewPolicyCard spaceId={spaceId} actorId={actorId} canEdit={canEdit} approvalPolicy="always-review"/></LanguageProvider>;
describe('Space review policy',()=>{
 beforeEach(()=>{localStorage.setItem('agentwiki.language.v1','zh-CN');vi.mocked(api.patch).mockResolvedValue({data:{id:'space-a',approvalPolicy:'no-review'}});});
 it('saves only the chosen policy, then updates the visible state and same-user Space listeners',async()=>{
  const received:string[]=[];const otherSpace=vi.fn(),otherActor=vi.fn();
  const cleanup=[listenSpaceReviewPolicyChanges('space-a','owner',value=>received.push(value)),listenSpaceReviewPolicyChanges('space-b','owner',otherSpace),listenSpaceReviewPolicyChanges('space-a','other',otherActor)];
  try{
   render(card());
   fireEvent.click(screen.getByRole('radio',{name:'无需审核'}));
   fireEvent.click(screen.getByRole('button',{name:'保存审核方式'}));
   expect(await screen.findByRole('status')).toHaveTextContent('审核方式已保存');
   expect(api.patch).toHaveBeenCalledWith('/spaces/space-a',{approvalPolicy:'no-review'});
   expect(received).toEqual(['no-review']);expect(otherSpace).not.toHaveBeenCalled();expect(otherActor).not.toHaveBeenCalled();
  }finally{cleanup.forEach(unsubscribe=>unsubscribe());}
 });
 it('retains a failed selection and does not announce it as a saved policy',async()=>{
  vi.mocked(api.patch).mockRejectedValueOnce(new Error('offline'));
  render(card());fireEvent.click(screen.getByRole('radio',{name:'无需审核'}));fireEvent.click(screen.getByRole('button',{name:'保存审核方式'}));
  expect(await screen.findByRole('alert')).toBeVisible();expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.getByRole('radio',{name:'无需审核'})).toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'保存审核方式'}));expect(await screen.findByRole('status')).toHaveTextContent('审核方式已保存');
 });
 it('keeps non-owners read-only even when they know the settings URL',()=>{
  render(card('space-a','admin',false));expect(screen.queryByRole('button',{name:'保存审核方式'})).not.toBeInTheDocument();expect(screen.queryByRole('radio')).not.toBeInTheDocument();expect(screen.getByText('始终审核',{exact:true})).toBeVisible();expect(api.patch).not.toHaveBeenCalled();
 });
 it('opens the current status from the header and restores focus after Escape',async()=>{
  render(<LanguageProvider><SpaceReviewPolicyStatus spaceId="space-a" actorId="owner" canEdit approvalPolicy="scoped-auto-publish"/></LanguageProvider>);
  const opener=screen.getByRole('button',{name:'内容审核：无需审核'});fireEvent.click(opener);
  const dialog=screen.getByRole('dialog',{name:'内容审核'});expect(within(dialog).getByRole('radio',{name:'无需审核'})).toBeChecked();
  expect(within(dialog).getByText(/已有待审内容仍需单独处理/)).toBeVisible();fireEvent.keyDown(dialog,{key:'Escape'});
  await waitFor(()=>expect(opener).toHaveFocus());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 });
 it('ignores a save completion after the account or Space changes',async()=>{
  let finish!:(value:unknown)=>void;vi.mocked(api.patch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const changed=vi.fn();const unsubscribe=listenSpaceReviewPolicyChanges('space-a','owner',changed);
  try{const view=render(card());fireEvent.click(screen.getByRole('radio',{name:'无需审核'}));fireEvent.click(screen.getByRole('button',{name:'保存审核方式'}));
   view.rerender(card('space-b','other'));
   await act(async()=>finish({data:{id:'space-a',approvalPolicy:'no-review'}}));expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(changed).not.toHaveBeenCalled();expect(screen.getByRole('radio',{name:'始终审核'})).toBeChecked();
  }finally{unsubscribe();}
 });
 it('keeps the saved policy visible if opening the header again before the parent refreshes',async()=>{
  render(<LanguageProvider><SpaceReviewPolicyStatus spaceId="space-a" actorId="owner" canEdit approvalPolicy="always-review"/></LanguageProvider>);
  fireEvent.click(screen.getByRole('button',{name:'内容审核：始终审核'}));fireEvent.click(screen.getByRole('radio',{name:'无需审核'}));fireEvent.click(screen.getByRole('button',{name:'保存审核方式'}));
  const opener=await screen.findByRole('button',{name:'内容审核：无需审核'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(opener);expect(screen.getByRole('radio',{name:'无需审核'})).toBeChecked();
 });
});
