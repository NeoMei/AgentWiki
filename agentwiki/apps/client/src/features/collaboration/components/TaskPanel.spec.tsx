import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../../context/LanguageContext';
import { TaskPanel } from './TaskPanel';
import type { CollaborationRun, TemplateSummary } from '../types';
const objective = 'Define setting rules, locations, factions, chronology, constraints, and unresolved world questions.';
const template: TemplateSummary = { id: 'system-novel', spaceId: null, system: true, slug: 'novel-writing', name: 'Novel', description: '', version: 1 };
const run = { id: 'r', name: 'My user prose / 我的文本', status: 'running', version: 1, roleBindings: [], updatedAt: '', tasks: [{ id: 'task', nodeId: 'world-bible', name: '世界观设定 / World bible', objective, ordinal: 0, generation: 1, status: 'ready', assigneeAgentId: 'a', roleSlotId: 'world-builder', skippable: false, todos: [], attempts: [], artifacts: [] }] } as CollaborationRun;
function Panel({ source = template, value = run }: { source?: TemplateSummary; value?: CollaborationRun }) {
  const { t } = useLanguage();
  return <TaskPanel run={value} systemTemplate={source} t={t} onAction={vi.fn()} onHistory={vi.fn()} />;
}
describe('system collaboration task presentation', () => {
  it.each([['zh-CN', '世界观设定', '定义世界规则、地点、阵营、时间线、约束和尚未解决的世界观问题。'], ['en', 'World bible', objective]])('localizes known system task names and objectives in %s', (locale, name, goal) => {
    localStorage.setItem('agentwiki.language.v1', locale);
    render(<LanguageProvider><Panel /></LanguageProvider>);
    expect(screen.getByRole('heading', { name })).toBeVisible();
    expect(screen.getByText(goal)).toBeVisible();
    expect(run.tasks![0].objective).toBe(objective);
  });
  it('does not translate copied/custom templates or edited prose', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const view = render(<LanguageProvider><Panel source={{ ...template, system: false }} /></LanguageProvider>);
    expect(screen.getByText(objective)).toBeVisible();
    view.rerender(<LanguageProvider><Panel value={{ ...run, tasks: [{ ...run.tasks![0], name: 'User name / 用户名', objective: 'User-authored objective' }] }} /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'User name / 用户名' })).toBeVisible();
    expect(screen.getByText('User-authored objective')).toBeVisible();
  });
});
