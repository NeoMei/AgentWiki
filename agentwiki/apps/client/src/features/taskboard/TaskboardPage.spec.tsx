import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { TaskboardPage } from './TaskboardPage';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const socketHandlers: Record<string, () => void> = {};
const fakeSocket = {
  on: vi.fn((ev: string, fn: () => void) => { if (ev === 'connect') socketHandlers[ev] = fn; }),
  off: vi.fn(),
  emit: vi.fn(),
  io: { on: vi.fn() },
  connect: vi.fn(() => socketHandlers['connect']?.()),
  disconnect: vi.fn(),
};
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));

const PLAN = ['# 登录流程 Implementation Plan', '', '**Goal:** 验收。', '', '### Task 1: 登录契约', '', '- [ ] **Step 1: 写失败测试**', '- [x] **Step 2: 跑通测试**'].join('\n');

const planBoard = () => ({
  board: {
    schema_version: 1,
    project: '登录流程',
    source_type: 'superpowers_plan',
    sources: ['docs/superpowers/plans/login.md'],
    updated_at: '2026-09-19T15:05:50Z',
    tasks: [
      { id: 'superpowers-plan-x', title: '登录流程', kind: 'phase', status: 'todo', scope_class: 'required', source: ['docs/superpowers/plans/login.md'], summary: '验收。' },
      { id: 'superpowers-plan-x-task-1', title: '登录契约', kind: 'implementation_task', status: 'in_progress', parent_id: 'superpowers-plan-x', scope_class: 'required', started_at: '2026-09-19T15:06:00Z', stages: { validation: 'unknown', implementation: 'in_progress', acceptance: 'unknown' } },
      { id: 'superpowers-plan-x-task-1-step-1', title: '写失败测试', kind: 'step', status: 'todo', parent_id: 'superpowers-plan-x-task-1', scope_class: 'required' },
      { id: 'superpowers-plan-x-task-1-step-2', title: '跑通测试', kind: 'step', status: 'done', parent_id: 'superpowers-plan-x-task-1', scope_class: 'required' },
    ],
  },
  read_at: '2026-09-19T15:06:30Z',
});

const emptyBoard = () => ({
  board: { schema_version: 1, project: '看板验收', source_type: 'manual', sources: [], updated_at: null, tasks: [] },
  read_at: '2026-09-19T15:00:00Z',
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/spaces/space-1/taskboard']}>
    <LanguageProvider>
      <Routes><Route path="/spaces/:id/taskboard" element={<TaskboardPage />} /></Routes>
    </LanguageProvider>
  </MemoryRouter>,
);

describe('TaskboardPage 项目全景 UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('imports a plan and renders phase road, canvas nodes, and running table', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: emptyBoard() });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...planBoard(), summary: { added: 4, updated: 0 } } });
    vi.mocked(api.get).mockResolvedValue(planBoard());
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    fireEvent.change(screen.getByLabelText('计划内容（Markdown）'), { target: { value: PLAN } });
    fireEvent.click(screen.getByRole('button', { name: /^导入$/ }));
    expect(await screen.findByRole('button', { name: '登录契约' })).toBeInTheDocument();
    // Upstream ba771da: steps appear in a deeper column after clicking the parent.
    fireEvent.click(screen.getByRole('button', { name: '登录契约' }));
    expect(await screen.findByRole('button', { name: '写失败测试' })).toBeInTheDocument();
    expect(screen.getByText(/正在执行/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /登录契约/ })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/spaces/space-1/taskboard/import-plan', expect.objectContaining({ content: PLAN }));
  });

  it('shows phase milestone with quick-jump controls', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: planBoard() });
    renderPage();
    await screen.findByRole('button', { name: '登录契约' });
    expect(screen.getByLabelText('快速跳转到阶段')).toBeInTheDocument();
    expect(screen.getByLabelText('上一个阶段')).toBeInTheDocument();
    expect(screen.getByLabelText('下一个阶段')).toBeInTheDocument();
  });

  it('updates task status from the inspector and keeps live socket wiring', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: planBoard() });
    vi.mocked(api.post).mockResolvedValue({ data: { task: { id: 's1', title: '写失败测试', status: 'in_progress' } } });
    renderPage();
    await screen.findByRole('button', { name: '登录契约' });
    fireEvent.click(screen.getByRole('button', { name: '登录契约' }));
    const stepNode = await screen.findByRole('button', { name: '写失败测试' });
    fireEvent.click(stepNode);
    await waitFor(() => expect(screen.getByLabelText('状态')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'in_progress' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/spaces/space-1/taskboard/tasks/superpowers-plan-x-task-1-step-1/status',
      { status: 'in_progress' },
    ));
    expect(fakeSocket.emit).toHaveBeenCalledWith('taskboard:subscribe', { spaceId: 'space-1' });
  });
});
