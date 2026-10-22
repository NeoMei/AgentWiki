import React from 'react';
import { runSystemTemplateText } from '../systemTemplateText';
import { CheckCircle2, Circle, LoaderCircle, XCircle } from 'lucide-react';
import type { CollaborationRun, CollaborationTask, HumanSpaceRole, TemplateSummary } from '../types';

export const TaskPanel: React.FC<{
  run: CollaborationRun;
  systemTemplate?: TemplateSummary | null;
  role?: HumanSpaceRole;
  userId?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onHistory: (kind: 'todos' | 'attempts') => void;
  onAction: (kind: 'retry' | 'reassign' | 'skip', task: CollaborationTask) => void;
  agentNames?: Map<string, string>;
}> = ({ run, systemTemplate, role, userId, t, onHistory, onAction, agentNames = new Map() }) => {
  const display = (value: string) => runSystemTemplateText(run, systemTemplate, value, t);
  const manager = role === 'owner' || role === 'admin';
  const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
  const inactive = terminal || run.status === 'paused';
  const canOperate = !terminal && !!role && (manager || run.startedById === userId);
  const tasks = [...(run.tasks ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <main data-testid="dashboard-section-current-task" className="aw-collab-task-panel min-h-0 min-w-0 lg:overflow-y-auto lg:overscroll-contain">
      <div className="aw-collab-panel-heading"><h2>{t('collaboration.dashboard.tasks')}</h2><span className="aw-collab-count" aria-hidden="true">{tasks.length}</span></div>
      {!tasks.length ? <div className="aw-collab-empty">{t('collaboration.dashboard.noTasks')}</div> : tasks.map((task) => {
        const historical = inactive && !['submitted', 'completed', 'skipped'].includes(task.status);
        const activeAttempt = !inactive && [...task.attempts].reverse().find((attempt) => ['claimed', 'running'].includes(attempt.status));
        return <article key={task.id} className="aw-collab-task">
          <div className="aw-collab-task-heading"><div className="min-w-0"><p className="aw-collab-task-generation">{t('collaboration.dashboard.generation', { value: task.generation })}</p><h3 className="aw-collab-task-title">{display(task.name)}</h3>{task.objectivePreview || task.objective ? <p className="aw-collab-task-objective">{display(task.objectivePreview ?? task.objective ?? '')}</p> : null}</div><span className="aw-collab-status" data-status={historical ? run.status : task.status}>{historical ? t('collaboration.dashboard.inactiveRunTask', { status: t(`collaboration.status.${run.status}`) }) : t(`collaboration.taskStatus.${task.status}`)}</span></div>
          {historical ? <p className="mt-1 text-xs text-gray-500">{t('collaboration.dashboard.taskSnapshotStatus', { status: t(`collaboration.taskStatus.${task.status}`) })}</p> : null}
          <p className="aw-collab-assignee">{t('collaboration.dashboard.frozenAssignee')}: {agentNames.get(task.assigneeAgentId) ?? task.assigneeAgentId}</p>
          {activeAttempt ? <p className="mt-1 text-xs text-gray-500">{t('collaboration.dashboard.leaseExpires', { date: new Date(activeAttempt.leaseExpiresAt).toLocaleString() })}</p> : null}
          <ol className="aw-collab-todos">{[...task.todos].sort((a, b) => a.ordinal - b.ordinal).map((todo, index) => <li key={todo.id} aria-label={t('collaboration.dashboard.todoLabel', { number: index + 1, name: display(todo.name), status: t(`collaboration.todoStatus.${todo.status}`) })} className="aw-collab-todo">{todo.status === 'done' ? <CheckCircle2 size={15} className="shrink-0 text-green-600" aria-hidden="true" /> : todo.status === 'doing' ? <LoaderCircle size={15} className="shrink-0 text-blue-600" aria-hidden="true" /> : todo.status === 'failed' ? <XCircle size={15} className="shrink-0 text-red-600" aria-hidden="true" /> : <Circle size={15} className="shrink-0 text-gray-400" aria-hidden="true" />}<span className="min-w-0 [overflow-wrap:anywhere]">{index + 1}. {display(todo.name)}</span></li>)}</ol>
          {task.todoCounts && task.todoCounts.total > task.todos.length ? <p className="mt-2 text-xs text-gray-500">{t('collaboration.dashboard.todoCount', { shown: task.todos.length, total: task.todoCounts.total })}</p> : null}
          <div className="aw-collab-task-actions">{canOperate && ['failed', 'retry_wait'].includes(task.status) ? <button type="button" onClick={() => onAction('retry', task)} className="aw-collab-button">{t('collaboration.dashboard.retryTask')}</button> : null}{canOperate && !['submitted', 'completed', 'skipped'].includes(task.status) ? <button type="button" onClick={() => onAction('reassign', task)} className="aw-collab-button">{t('collaboration.dashboard.reassign')}</button> : null}{!terminal && manager && task.skippable && !['submitted', 'completed', 'skipped'].includes(task.status) ? <button type="button" onClick={() => onAction('skip', task)} className="aw-collab-button aw-collab-button-ghost aw-collab-button-danger">{t('collaboration.dashboard.skip')}</button> : null}</div>
        </article>;
      })}
      {tasks.length ? <div className="aw-collab-task-footer"><button type="button" onClick={() => onHistory('todos')} className="aw-collab-button aw-collab-button-ghost">{t('collaboration.dashboard.viewAllTodos')}</button><button type="button" onClick={() => onHistory('attempts')} className="aw-collab-button aw-collab-button-ghost">{t('collaboration.dashboard.viewAllAttempts')}</button></div> : null}
    </main>
  );
};
