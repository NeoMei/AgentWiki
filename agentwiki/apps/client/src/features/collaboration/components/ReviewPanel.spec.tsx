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
  it.each(['unloaded', 'conflict', 'missing-baseline', 'unauthorized'])('never sends approval for %s page comparison', (mode) => {
    const onDecision = vi.fn();
    const comparison = { mode: 'candidate', canDecide: mode !== 'unauthorized', conflict: mode === 'conflict', target: { pageId: 'p', title: 'Page' }, baseline: { available: mode !== 'missing-baseline', markdown: null }, candidate: { markdown: 'new', changeSetId: 'c' }, current: { markdown: 'current' } };
    render(<MemoryRouter><ReviewPanel {...props} run={{ ...props.run, reviews: [{ ...review, pagePublication: { pageId: 'p', changeSetId: 'c' } }] }} detail={mode === 'unloaded' ? null : { reviewId: 'pending', kind: 'comparison', comparison }} onDecision={onDecision} /></MemoryRouter>);
    const approve = screen.queryByRole('button', { name: '通过' });
    if (approve) fireEvent.click(approve);
    expect(onDecision).not.toHaveBeenCalled();
  });
});
