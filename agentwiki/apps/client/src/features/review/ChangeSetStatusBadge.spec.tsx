import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { ChangeSetStatusBadge } from './ChangeSetStatusBadge';

const renderBadge = (status: string) => render(<LanguageProvider><ChangeSetStatusBadge status={status} /></LanguageProvider>);

describe('ChangeSetStatusBadge', () => {
  afterEach(cleanup);
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it.each([
    ['pending_review', 'Pending review'],
    ['approved', 'Approved'],
    ['published', 'Published'],
    ['reverted', 'Reverted'],
    ['rejected', 'Rejected'],
  ])('renders %s as a readable label', (status, label) => {
    renderBadge(status);
    expect(screen.getByTestId(`status-badge-${status}`)).toHaveTextContent(label);
  });

  it('renders Chinese labels when language is zh-CN', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    renderBadge('pending_review');
    expect(screen.getByTestId('status-badge-pending_review')).toHaveTextContent('待审核');
  });

  it('falls back to the raw status for unknown values', () => {
    renderBadge('custom_state');
    expect(screen.getByText('custom_state')).toBeInTheDocument();
  });
});
