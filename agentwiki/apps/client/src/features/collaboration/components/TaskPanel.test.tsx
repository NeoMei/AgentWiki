import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../../context/LanguageContext';
import { TaskPanel } from './TaskPanel';
import type { CollaborationRun } from '../types';

function Panel({ status }: { status: CollaborationRun['status'] }) {
  const { t } = useLanguage();
  const run = {
    id: 'run-1', status, startedById: 'u1',
    tasks: [{ id: 'task-1', ordinal: 0, name: 'Write page', status: 'ready', generation: 1,
      skippable: true, assigneeAgentId: 'a1', attempts: [], todos: [] }],
  } as unknown as CollaborationRun;
  return <TaskPanel run={run} role="owner" userId="u1" t={t} onHistory={vi.fn()} onAction={vi.fn()} />;
}

describe('TaskPanel run lifecycle', () => {
  it.each(['cancelled', 'failed', 'completed'] as const)('renders unfinished tasks as historical when the run is %s', (status) => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><Panel status={status} /></LanguageProvider>);
    const task = within(screen.getByRole('article'));
    expect(task.queryByText('Ready', { exact: true })).not.toBeInTheDocument();
    expect(task.getByText('Last task state: Ready')).toBeVisible();
    expect(task.queryByRole('button', { name: 'Reassign' })).not.toBeInTheDocument();
    expect(task.queryByRole('button', { name: 'Skip task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View all attempts' })).toBeVisible();
  });

  it('distinguishes paused tasks from ready tasks while retaining recovery controls', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = render(<LanguageProvider><Panel status="paused" /></LanguageProvider>);
    expect(screen.queryByText('Ready', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Last task state: Ready')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeVisible();
    view.rerender(<LanguageProvider><Panel status="running" /></LanguageProvider>);
    expect(screen.getByText('Ready', { exact: true })).toBeVisible();
    expect(screen.queryByText('Last task state: Ready')).not.toBeInTheDocument();
  });
});
