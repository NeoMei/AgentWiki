import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { AssistCandidateReview } from './AssistCandidateReview';
import { completeAssistCandidate } from './assistCandidate';
import { captureAssistTarget } from './assistTargets';
afterEach(cleanup);
describe('independent candidate edit review', () => {
  const candidate = completeAssistCandidate({taskId:'t',pageId:'p',spaceId:'s',userId:'u',baseTitle:'T',baseContent:'one\nkeep\ntwo\n',baseUpdatedAt:'2026-10-06T00:00:00Z',assistTarget:captureAssistTarget('one\nkeep\ntwo\n','document',0,0,'2026-10-06T00:00:00Z')!,content:'',status:'generating'},'ONE\nkeep\nTWO\n');
  it('exposes independent accept actions only to parents supporting scoped application', () => {
    localStorage.setItem('agentwiki.language.v1','en'); const onAccept = vi.fn();
    const ui=render(<LanguageProvider><AssistCandidateReview candidate={candidate} canEdit onAccept={onAccept} onDiscard={()=>{}} /></LanguageProvider>);
    expect(screen.queryByRole('button',{name:'Accept change 1'})).not.toBeInTheDocument();
    ui.rerender(<LanguageProvider><AssistCandidateReview candidate={{...candidate,acceptedEditIds:['edit-1']}} canEdit supportsScopedApply onAccept={onAccept} onDiscard={()=>{}} /></LanguageProvider>);
    expect(screen.getByRole('button',{name:'Accept change 1'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Accept change 2'})); expect(onAccept).toHaveBeenCalledWith('edit-2');
  });
});
