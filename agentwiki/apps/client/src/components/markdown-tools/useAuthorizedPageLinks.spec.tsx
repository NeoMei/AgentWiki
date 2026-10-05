import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import api from '../../api/client';
import { useAuthorizedPageLinks } from './useAuthorizedPageLinks';
vi.mock('../../api/client',()=>({default:{get:vi.fn()}}));
describe('on-demand authorized Space links',()=>{
  it('does not fetch until requested, filters scope and caps results',async()=>{
    vi.mocked(api.get).mockReset();
    const {result}=renderHook(()=>useAuthorizedPageLinks('u','s','p',true));
    expect(api.get).not.toHaveBeenCalled();
    vi.mocked(api.get).mockResolvedValue({data:{data:[{id:'a',title:'Same',spaceId:'s'},{id:'b',title:'Other',spaceId:'other'}]}});
    const pages=await result.current();
    expect(pages).toEqual([{id:'a',title:'Same'}]);
    expect(api.get).toHaveBeenCalledWith('/pages',expect.objectContaining({params:{spaceId:'s',take:100},signal:expect.any(AbortSignal)}));
  });
  it('aborts and refuses delayed results after identity or permission changes',async()=>{
    let resolve!: (value:any)=>void;
    vi.mocked(api.get).mockImplementation(()=>new Promise((done)=>{resolve=done;}));
    const {result,rerender}=renderHook(({user,canEdit})=>useAuthorizedPageLinks(user,'s','p',canEdit),{initialProps:{user:'u',canEdit:true}});
    const pending=result.current();
    rerender({user:'other',canEdit:false});
    act(()=>resolve({data:{data:[{id:'a',title:'Private',spaceId:'s'}]}}));
    await expect(pending).rejects.toThrow('changed scope');
    await expect(result.current()).rejects.toThrow('unavailable');
  });
});
