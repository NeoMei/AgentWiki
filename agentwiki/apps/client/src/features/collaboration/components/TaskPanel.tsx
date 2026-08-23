import React from 'react';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import type { CollaborationRun, CollaborationTask, HumanSpaceRole } from '../types';

export const TaskPanel: React.FC<{
  run: CollaborationRun;
  role?: HumanSpaceRole;
  userId?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onAction: (kind: 'retry' | 'reassign' | 'skip', task: CollaborationTask) => void;
}> = ({ run, role, userId, t, onAction }) => {
  const manager = role === 'owner' || role === 'admin';
  const canOperate = manager || run.startedById === userId;
  const tasks = [...(run.tasks ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <main data-testid="dashboard-section-current-task" className="order-2 min-w-0 space-y-4 lg:col-start-2 lg:row-span-3">
      <h2 className="text-lg font-semibold">{t('collaboration.dashboard.tasks')}</h2>
      {!tasks.length ? <div className="rounded-xl border bg-white py-10 text-center text-sm text-gray-500">{t('collaboration.dashboard.noTasks')}</div> : tasks.map((task) => {
        const activeAttempt = [...task.attempts].reverse().find((attempt) => ['claimed', 'running'].includes(attempt.status));
        return <article key={task.id} className="min-w-0 rounded-xl border bg-white p-4">
          <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-gray-500">{t('collaboration.dashboard.generation', { value: task.generation })}</p><h3 className="mt-1 break-words font-semibold">{task.name}</h3><p className="mt-1 break-words text-sm text-gray-600">{task.objective}</p></div><span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs">{t(`collaboration.taskStatus.${task.status}`)}</span></div>
          {activeAttempt ? <p className="mt-3 text-xs text-gray-500">{t('collaboration.dashboard.leaseExpires', { date: new Date(activeAttempt.leaseExpiresAt).toLocaleString() })}</p> : null}
          <ol className="mt-4 space-y-2">{[...task.todos].sort((a, b) => a.ordinal - b.ordinal).map((todo, index) => <li key={todo.id} aria-label={`Todo ${index + 1}: ${todo.name}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">{todo.status === 'done' ? <CheckCircle2 size={15} className="shrink-0 text-green-600" aria-hidden="true" /> : todo.status === 'doing' ? <LoaderCircle size={15} className="shrink-0 text-blue-600" aria-hidden="true" /> : <Circle size={15} className="shrink-0 text-gray-400" aria-hidden="true" />}<span className="min-w-0 break-words">{index + 1}. {todo.name}</span></li>)}</ol>
          <div className="mt-4 flex flex-wrap gap-2">{canOperate && ['failed', 'retry_wait'].includes(task.status) ? <button type="button" onClick={() => onAction('retry', task)} className="min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.retryTask')}</button> : null}{canOperate && !['submitted', 'completed', 'skipped'].includes(task.status) ? <button type="button" onClick={() => onAction('reassign', task)} className="min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.reassign')}</button> : null}{manager && task.skippable && !['submitted', 'completed', 'skipped'].includes(task.status) ? <button type="button" onClick={() => onAction('skip', task)} className="min-h-9 rounded-lg border border-red-200 px-3 text-sm text-red-700">{t('collaboration.dashboard.skip')}</button> : null}</div>
        </article>;
      })}
    </main>
  );
};
