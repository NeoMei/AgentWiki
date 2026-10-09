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
  return <TaskPanel run={value} systemTemplate={source} t={t} onAction={vi.fn()} onHistory={vi.fn()} agentNames={new Map([["a", "Define world rules / 自定义 Agent"]])} />;
}
describe('system collaboration task presentation', () => {
  it.each([['zh-CN', '世界观设定', '定义世界规则、地点、阵营、时间线、约束和尚未解决的世界观问题。'], ['en', 'World bible', objective]])('localizes known system task names and objectives in %s', (locale, name, goal) => {
    localStorage.setItem('agentwiki.language.v1', locale);
    render(<LanguageProvider><Panel /></LanguageProvider>);
    expect(screen.getByRole('heading', { name })).toBeVisible();
    expect(screen.getByText(goal)).toBeVisible();
    expect(run.tasks![0].objective).toBe(objective);
  });
  it.each([['zh-CN', '定义世界规则', '待办 1: 定义世界规则, 待处理', '1 / 3 项待办'], ['en', 'Define world rules', 'Todo 1: Define world rules, Pending', '1 / 3 Todos']])('localizes built-in Todos and their accessible labels/counts in %s', (locale, name, label, count) => {
    localStorage.setItem('agentwiki.language.v1', locale);
    const value = { ...run, tasks: [{ ...run.tasks![0], todos: [{ id: 'todo', name: 'Define world rules', ordinal: 0, status: 'pending' as const, required: true, generation: 1 }], todoCounts: { total: 3, pending: 3, doing: 0, done: 0, failed: 0 } }] };
    const view = render(<LanguageProvider><Panel value={value} /></LanguageProvider>);
    expect(screen.getByRole('listitem', { name: label })).toHaveTextContent(name);
    expect(screen.getByText(count)).toBeVisible();
    expect(screen.getByText(/Define world rules \/ 自定义 Agent/)).toBeVisible();
    view.rerender(<LanguageProvider><Panel value={value} source={{ ...template, system: false }} /></LanguageProvider>);
    expect(screen.getByText('1. Define world rules')).toBeVisible();
  });
  it('localizes a composite system Run with no legacy template ID using server provenance', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const value = { ...run, templateId: undefined, systemTemplateSource: { slug: 'novel-writing' }, tasks: [{ ...run.tasks![0], todos: [{ id: 't', ordinal: 0, name: 'Define world rules', status: 'pending', required: true, generation: 1 }] }] } as CollaborationRun;
    function CompositePanel() { const { t } = useLanguage(); return <TaskPanel run={value} t={t} onAction={vi.fn()} onHistory={vi.fn()} agentNames={new Map([['a', 'Define world rules']])} />; }
    render(<LanguageProvider><CompositePanel /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: '世界观设定' })).toBeVisible();
    expect(screen.getByText('定义世界规则、地点、阵营、时间线、约束和尚未解决的世界观问题。')).toBeVisible();
    expect(screen.getByText('1. 定义世界规则')).toBeVisible();
    expect(screen.getByText(/Define world rules$/)).toBeVisible();
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
