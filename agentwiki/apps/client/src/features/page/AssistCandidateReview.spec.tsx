import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { AssistCandidateReview } from './AssistCandidateReview';
import { completeAssistCandidate } from './assistCandidate';
import { captureAssistTarget } from './assistTargets';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));
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
  it('presents numbered independent cards and accepted progress before an optional comparison', () => {
    const onAccept = vi.fn(), onDiscard = vi.fn();
    const { container } = render(<LanguageProvider><AssistCandidateReview candidate={{...candidate, acceptedEditIds: ['edit-1', 'unknown']}} canEdit supportsScopedApply onAccept={onAccept} onDiscard={onDiscard} /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'Candidate review' })).toBeVisible();
    expect(screen.getByText('1 of 2 changes accepted')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Change 1' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Change 2' })).toBeVisible();
    const disclosure = container.querySelector('details')!;
    expect(disclosure).not.toHaveAttribute('open');
    expect(within(disclosure).getByText('Full-document comparison')).toBeVisible();
    fireEvent.click(within(disclosure).getByText('Full-document comparison'));
    expect(disclosure).toHaveAttribute('open');
    expect(within(disclosure).getByLabelText('Markdown diff')).toBeVisible();
    fireEvent.click(within(disclosure).getByText('Full-document comparison'));
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Download original' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download candidate' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Accept change 1' }));
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept change 2' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenLastCalledWith('edit-2');
    fireEvent.click(screen.getByRole('button', { name: 'Accept to draft' }));
    expect(onAccept).toHaveBeenCalledTimes(2);
    expect(onAccept).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
  it('keeps indivisible and unsupported candidates on the primary shared diff', () => {
    const indivisible = completeAssistCandidate({...candidate, editPlan: undefined, status: 'generating'}, 'ONE\nkeep\ntwo\n');
    const ui = render(<LanguageProvider><AssistCandidateReview candidate={indivisible} canEdit supportsScopedApply onAccept={vi.fn()} onDiscard={vi.fn()} /></LanguageProvider>);
    expect(screen.getAllByLabelText('Markdown diff')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Accept change 1' })).toBeEnabled();
    expect(screen.getByText('This candidate is accepted as one indivisible change.')).toBeVisible();
    expect(ui.container.querySelector('details')).toBeNull();
    ui.rerender(<LanguageProvider><AssistCandidateReview candidate={candidate} canEdit onAccept={vi.fn()} onDiscard={vi.fn()} /></LanguageProvider>);
    expect(screen.getAllByLabelText('Markdown diff')).toHaveLength(1);
    expect(ui.container.querySelector('details')).toBeNull();
  });
  it.each([{canEdit: false, status: 'ready' as const}, {canEdit: true, status: 'conflict' as const}])('preserves disabled accept actions for $status with canEdit=$canEdit', ({canEdit, status}) => {
    const onAccept = vi.fn();
    render(<LanguageProvider><AssistCandidateReview candidate={{...candidate, status}} canEdit={canEdit} supportsScopedApply onAccept={onAccept} onDiscard={vi.fn()} /></LanguageProvider>);
    for (const name of ['Accept change 1', 'Accept change 2', 'Accept to draft']) {
      const button = screen.getByRole('button', { name }); expect(button).toBeDisabled(); fireEvent.click(button);
    }
    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeVisible();
    if (status === 'conflict') expect(screen.getByRole('alert')).toHaveTextContent('Please regenerate');
  });
  it('keeps long-preview warnings visible outside the optional comparison and on indivisible candidates', () => {
    const long = {...candidate, baseContent: `${candidate.baseContent}${'same\n'.repeat(350)}`, content: `${candidate.content}${'same\n'.repeat(350)}`};
    const ui = render(<LanguageProvider><AssistCandidateReview candidate={long} canEdit supportsScopedApply onAccept={vi.fn()} onDiscard={vi.fn()} /></LanguageProvider>);
    const warning = screen.getByText(/Long document:/);
    expect(warning).toBeVisible();
    expect(warning.closest('details')).toBeNull();
    ui.rerender(<LanguageProvider><AssistCandidateReview candidate={{...long, editPlan: {...long.editPlan!, indivisible: true}}} canEdit supportsScopedApply onAccept={vi.fn()} onDiscard={vi.fn()} /></LanguageProvider>);
    expect(screen.getByText(/Long document:/)).toBeVisible();
  });
  it('downloads the untouched complete source and candidate from the collapsed view', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:review');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<LanguageProvider><AssistCandidateReview candidate={candidate} canEdit supportsScopedApply onAccept={vi.fn()} onDiscard={vi.fn()} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', {name: 'Download original'}));
    fireEvent.click(screen.getByRole('button', {name: 'Download candidate'}));
    expect(create).toHaveBeenCalledTimes(2);
    const texts = await Promise.all(create.mock.calls.map(([blob]) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob as Blob);
    })));
    expect(texts).toEqual([candidate.baseContent, candidate.content]);
    expect(click.mock.instances.map((anchor) => (anchor as HTMLAnchorElement).download)).toEqual(['assist-original.md', 'assist-candidate.md']);
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('uses Chinese headings, progress, disclosure and explicit actions', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><AssistCandidateReview candidate={{...candidate, acceptedEditIds: ['edit-1']}} canEdit supportsScopedApply onAccept={vi.fn()} onDiscard={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('heading', {name: '候选审阅'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '变更 2'})).toBeVisible();
    expect(screen.getByText('已接受 1 / 2 项变更')).toBeVisible();
    expect(screen.getByText('整篇文档对比')).toBeVisible();
    expect(screen.getByRole('button', {name: '接受变更 1'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '下载候选'})).toBeVisible();
  });
});
