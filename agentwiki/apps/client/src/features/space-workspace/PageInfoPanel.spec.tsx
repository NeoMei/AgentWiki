import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { PageInfoPanel } from './PageInfoPanel';

const details = {
  spaceId: 'space-1',
  provenance: {
    createdByAgent: { name: 'Writer' },
    run: { id: 'run-1', stage: 'published', source: { name: 'Repository', type: 'git', uri: 'https://example.test/repo' } },
    title: 'Candidate',
    status: 'published',
    approvals: [],
  },
  evidence: [{ id: 'e-1', quote: 'Evidence quote', confidence: 0.8, sourceVersion: { version: 2, metadata: {}, files: [] } }],
  lastModifiedByUser: { id: 'u-1', name: 'Editor' },
  lastChange: { id: 'change-1', title: 'Reviewed change', status: 'accepted' },
  canEdit: true,
  onOpenHistory: vi.fn(),
};

const renderPanel = (props: Partial<React.ComponentProps<typeof PageInfoPanel>> = {}) => render(
  <LanguageProvider><MemoryRouter><PageInfoPanel {...details} onDelete={vi.fn()} deleting={false} {...props} /></MemoryRouter></LanguageProvider>,
);

describe('PageInfoPanel', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it('keeps provenance, evidence, changes, and operations on demand', () => {
    const onDelete = vi.fn();
    const onOpenHistory = vi.fn();
    renderPanel({ onDelete, onOpenHistory });
    const trigger = screen.getByRole('button', { name: 'Page information' });
    expect(screen.queryByText('Evidence quote')).not.toBeInTheDocument();
    fireEvent.click(trigger);

    expect(screen.getByRole('complementary', { name: 'Page information' })).toBeInTheDocument();
    expect(screen.getByText('Repository · git')).toBeInTheDocument();
    expect(screen.getByText('Evidence quote')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reviewed change/ })).toHaveAttribute('href', '/review?changeSet=change-1');
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('preserves read-only permissions and restores trigger focus only for Escape', () => {
    renderPanel({ canEdit: false });
    const trigger = screen.getByRole('button', { name: 'Page information' });
    fireEvent.click(trigger);
    expect(screen.queryByRole('button', { name: 'Delete page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Version history' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Page information' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not render a permanent empty provenance column for a human page', () => {
    renderPanel({ provenance: null, evidence: [] });
    expect(screen.queryByText('Human-created page. No automated source or approval record.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Page information' }));
    expect(screen.getByText('Human-created page. No automated source or approval record.')).toBeInTheDocument();
  });

  it('renders the fixed panel outside a filtered reading toolbar', () => {
    render(<LanguageProvider><MemoryRouter>
      <div data-testid="filtered-toolbar" data-reading-toolbar style={{ backdropFilter: 'blur(8px)' }}>
        <PageInfoPanel {...details} onDelete={vi.fn()} deleting={false} />
      </div>
    </MemoryRouter></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Page information' }));
    const toolbar = screen.getByTestId('filtered-toolbar');
    const panel = screen.getByRole('complementary', { name: 'Page information' });
    expect(toolbar).not.toContainElement(panel);
    expect(panel.parentElement).toBe(document.body);
  });
});
