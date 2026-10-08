import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { messages } from '../../../i18n/messages';
import { ReviewPanel } from './ReviewPanel';
const t = (key: string) => messages['zh-CN'][key] ?? key;
const review = { id: 'pending', nodeId: 'review', status: 'pending', canDecide: true, approvalCriteria: ['Evidence is complete'], artifactId: 'a', allowTerminate: true };
const artifact = { id: 'a', payload: { markdown: 'Evidence is complete' }, evidence: 'user evidence' };
const props: any = { run: { tasks: [], reviews: [{ ...review, id: 'approved', status: 'approved' }, review, { ...review, id: 'pending-2' }], systemTemplateSource: { slug: 'coding' } }, spaceId: 's', t, artifacts: { pending: artifact, 'pending-2': artifact }, artifactErrors: {}, detail: null, resolvingConflict: false, onLoadDetail: vi.fn(), onRetryArtifact: vi.fn(), onHistory: vi.fn(), onDecision: vi.fn(), onResolveConflict: vi.fn(), isHumanMember: true };
describe('ReviewPanel presentation and decision guards', () => {
  it('puts pending reviews first stably and actions in their card header, localizing criteria only', () => {
    const view = render(<MemoryRouter><ReviewPanel {...props} /></MemoryRouter>);
    const cards = [...view.container.querySelectorAll('article')];
    expect(cards.map(el => el.getAttribute('data-review-id'))).toEqual(['pending', 'pending-2', 'approved']);
    const header = within(cards[0]).getByTestId('review-card-header');
    expect(within(header).getByRole('button', { name: '通过' })).toBeVisible();
    expect(cards[0]).toHaveTextContent('证据完整');
    expect(cards[0]).toHaveTextContent('Evidence is complete');
  });
  it('offers safe rejection, termination and recovery for pre-detected conflict in waiting_review', () => {
    const onDecision = vi.fn(); const onResolveConflict = vi.fn();
    const comparison = { mode: 'candidate', canDecide: true, conflict: true, target: { pageId: 'p', title: 'Page' }, baseline: { available: true, markdown: 'old' }, candidate: { markdown: 'new', changeSetId: 'c' }, current: { markdown: 'human', contentHash: 'hash' } };
    render(<MemoryRouter><ReviewPanel {...props} run={{ ...props.run, status: 'waiting_review', pauseReason: null, reviews: [{ ...review, sourceTaskId: 'task', pagePublication: { pageId: 'p', changeSetId: 'c' } }] }} detail={{ reviewId: 'pending', kind: 'comparison', comparison }} onDecision={onDecision} onResolveConflict={onResolveConflict} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: '通过' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '驳回返工' }));
    fireEvent.click(screen.getByRole('button', { name: '终止运行' }));
    fireEvent.click(screen.getByRole('button', { name: '基于当前页面重新生成' }));
    fireEvent.click(screen.getByRole('button', { name: '采纳当前页面' }));
    expect(onDecision.mock.calls.map(call => call[0])).toEqual(['reject_for_revision', 'terminate']);
    expect(onResolveConflict.mock.calls.map(call => call[0])).toEqual(['regenerate', 'adopt_current']);
  });
  it.each(['unloaded', 'conflict', 'missing-baseline', 'unauthorized'])('never sends approval for %s page comparison', (mode) => {
    const onDecision = vi.fn();
    const comparison = { mode: 'candidate', canDecide: mode !== 'unauthorized', conflict: mode === 'conflict', target: { pageId: 'p', title: 'Page' }, baseline: { available: mode !== 'missing-baseline', markdown: null }, candidate: { markdown: 'new', changeSetId: 'c' }, current: { markdown: 'current' } };
    render(<MemoryRouter><ReviewPanel {...props} run={{ ...props.run, reviews: [{ ...review, pagePublication: { pageId: 'p', changeSetId: 'c' } }] }} detail={mode === 'unloaded' ? null : { reviewId: 'pending', kind: 'comparison', comparison }} onDecision={onDecision} /></MemoryRouter>);
    const approve = screen.queryByRole('button', { name: '通过' });
    if (approve) fireEvent.click(approve);
    expect(onDecision).not.toHaveBeenCalled();
  });
});
