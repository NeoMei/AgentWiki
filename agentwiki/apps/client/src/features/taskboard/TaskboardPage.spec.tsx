import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('reads a selected Markdown file and imports its contents', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: emptyBoard() });
    vi.mocked(api.post).mockResolvedValue({ data: { ...planBoard(), summary: { added: 4, updated: 0 } } });
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    // Opening import must expose the file chooser without a second mode switch.
    const input = screen.getByLabelText('选择计划文件');
    expect(screen.getByRole('button', { name: /^导入$/ })).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File([PLAN], 'login.md', { type: 'text/markdown' })] } });
    await screen.findByText(/已读取：login.md/);
    fireEvent.click(screen.getByRole('button', { name: /^导入$/ }));
    expect(await screen.findByRole('button', { name: '登录契约' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/spaces/space-1/taskboard/import-plan', {
      content: PLAN, sourcePath: 'login.md', syncStatus: false,
    });
  });

  it('clears previously loaded content when a replacement file is empty', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: emptyBoard() });
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    const input = screen.getByLabelText('选择计划文件');
    fireEvent.change(input, { target: { files: [new File([PLAN], 'login.md')] } });
    await screen.findByText(/已读取：login.md/);
    fireEvent.change(input, { target: { files: [new File([], 'empty.md')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('文件为空');
    expect(screen.getByRole('button', { name: /^导入$/ })).toBeDisabled();
    expect(screen.queryByText(/已读取：login.md/)).not.toBeInTheDocument();
  });

  it('keeps a JSON file available for retry after the server rejects the import', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: emptyBoard() });
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { code: 'TASKBOARD_INVALID' } } })
      .mockResolvedValueOnce({ data: { ...planBoard(), summary: { added: 4, updated: 0 } } });
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    const content = JSON.stringify(planBoard().board);
    fireEvent.change(screen.getByLabelText('选择计划文件'), { target: { files: [new File([content], 'board.json')] } });
    await screen.findByText(/已读取：board.json/);
    fireEvent.click(screen.getByRole('button', { name: /^导入$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('看板数据无效');
    expect(screen.getByText(/已读取：board.json/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^导入$/ }));
    expect(await screen.findByRole('button', { name: '登录契约' })).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/spaces/space-1/taskboard/import-plan', {
      content, sourcePath: 'board.json', syncStatus: false,
    });
  });

  it('hides navigation for an empty board and restores it after import', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: emptyBoard() });
    vi.mocked(api.post).mockResolvedValue({ data: { ...planBoard(), summary: { added: 4, updated: 0 } } });
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('快速跳转到阶段')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    fireEvent.click(screen.getByRole('button', { name: '粘贴内容' }));
    fireEvent.change(screen.getByLabelText('计划内容（Markdown）'), { target: { value: PLAN } });
    fireEvent.click(screen.getByRole('button', { name: /^导入$/ }));
    expect(await screen.findByRole('button', { name: '登录契约' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('navigates independent roots alongside phases without promoting nested phases', async () => {
    const data = planBoard();
    data.board.tasks.push(
      { id: 'manual-root', title: '独立工作', kind: 'task', status: 'todo', parent_id: '', scope_class: 'required' },
      { id: 'manual-child', title: '独立工作的步骤', kind: 'step', status: 'todo', parent_id: 'manual-root', scope_class: 'required' },
      { id: 'nested-phase', title: '嵌套阶段', kind: 'phase', status: 'todo', parent_id: 'superpowers-plan-x', scope_class: 'required' },
    );
    vi.mocked(api.get).mockResolvedValue({ data });
    renderPage();
    const jump = await screen.findByLabelText('快速跳转到阶段');
    expect(within(jump).getByRole('option', { name: /独立工作/ })).toBeInTheDocument();
    expect(within(jump).getAllByRole('option')).toHaveLength(2);
    expect(within(jump).queryByRole('option', { name: /嵌套阶段/ })).not.toBeInTheDocument();
    fireEvent.change(jump, { target: { value: 'manual-root' } });
    expect(await screen.findByRole('button', { name: '独立工作的步骤' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录契约' })).not.toBeInTheDocument();
    fireEvent.change(jump, { target: { value: 'superpowers-plan-x' } });
    expect(await screen.findByRole('button', { name: '登录契约' })).toBeInTheDocument();
  });

  it('imports a plan and renders phase road, canvas nodes, and running table', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: emptyBoard() });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...planBoard(), summary: { added: 4, updated: 0 } } });
    vi.mocked(api.get).mockResolvedValue(planBoard());
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    fireEvent.click(screen.getByRole('button', { name: '粘贴内容' }));
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
