import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { TaskboardPage } from './TaskboardPage';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const PLAN = ['# Demo Plan', '', '### Task 1: 契约', '', '- [ ] **Step 1: 写测试**'].join('\n');

const boardOf = (tasks: Array<Record<string, unknown>>) => ({
  board: {
    schema_version: 1,
    project: '演示项目',
    source_type: 'manual',
    sources: [],
    updated_at: null,
    tasks,
  },
  read_at: '2026-09-19T00:00:00Z',
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/spaces/space-1/taskboard']}>
    <LanguageProvider>
      <Routes><Route path="/spaces/:id/taskboard" element={<TaskboardPage />} /></Routes>
    </LanguageProvider>
  </MemoryRouter>,
);

describe('TaskboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders the board tree with status pills', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: boardOf([
      { id: 'P', title: '阶段一', kind: 'phase', status: 'todo' },
      { id: 'T1', title: '写契约', kind: 'implementation_task', status: 'done', parent_id: 'P' },
    ]) });
    renderPage();
    await waitFor(() => expect(screen.getByText('演示项目')).toBeInTheDocument());
    expect(screen.getByText('阶段一')).toBeInTheDocument();
    expect(screen.getByText('写契约')).toBeInTheDocument();
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '进度：1/1')).toBeInTheDocument();
  });

  it('imports a superpowers plan and shows the summary', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: boardOf([]) });
    vi.mocked(api.post).mockResolvedValue({
      data: {
        ...boardOf([
          { id: 'superpowers-plan-x', title: 'Demo Plan', kind: 'phase', status: 'todo' },
        ]),
        summary: { added: 1, updated: 0 },
      },
    });
    renderPage();
    await screen.findByText('看板为空，先导入 Superpowers 计划或添加任务。');
    fireEvent.click(screen.getByRole('button', { name: '导入计划' }));
    fireEvent.change(screen.getByLabelText('计划内容（Markdown）'), { target: { value: PLAN } });
    fireEvent.click(screen.getByRole('button', { name: /^导入$/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-1/taskboard/import-plan', expect.objectContaining({ content: PLAN })));
    expect(await screen.findByText(/导入完成：新增 1/)).toBeInTheDocument();
  });

  it('renders phase rail scrolling controls and jumps between phases', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: boardOf([
      { id: 'P1', title: '阶段一', kind: 'phase', status: 'todo' },
      { id: 'P2', title: '阶段二', kind: 'phase', status: 'todo' },
    ]) });
    renderPage();
    await screen.findByRole('button', { name: /阶段一/ });
    expect(screen.getByLabelText('上一个阶段')).toBeInTheDocument();
    expect(screen.getByLabelText('下一个阶段')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /阶段一/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('快速跳转到阶段'), { target: { value: 'P2' } });
    expect(screen.getByRole('button', { name: /阶段二/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports a status change for the selected task', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: boardOf([
      { id: 'T1', title: '写契约', kind: 'task', status: 'todo' },
    ]) });
    vi.mocked(api.post).mockResolvedValue({ data: { task: { id: 'T1', title: '写契约', status: 'in_progress' } } });
    renderPage();
    await screen.findByText('写契约');
    fireEvent.click(screen.getByText('写契约'));
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'in_progress' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-1/taskboard/tasks/T1/status', { status: 'in_progress' }));
  });
});
