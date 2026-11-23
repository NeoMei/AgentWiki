import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentList } from './AgentList';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

describe('AgentList create dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
  });

  it.each([
    ['zh-CN', '所有者：张三（zhang@example.test）'],
    ['en', 'Owner: 张三 (zhang@example.test)'],
  ])('shows the server-provided owner in %s, including archived Agents', async (language, ownerLabel) => {
    localStorage.setItem('agentwiki.language.v1', language);
    vi.mocked(api.get).mockResolvedValue({ data: [{
      id: 'agent-owned', name: 'Codex', status: 'archived', grants: [],
      owner: { id: 'owner-1', name: '张三', email: 'zhang@example.test' },
      _count: { credentials: 0, auditEvents: 1 },
    }] });
    render(<MemoryRouter><LanguageProvider><AgentList /></LanguageProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: language === 'zh-CN' ? '查看已归档智能体' : 'View archived Agents' }));

    expect(await screen.findByRole('link', { name: /Codex/ })).toHaveTextContent(ownerLabel);
  });

  it('preserves dollar sequences in the owner name literally', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockResolvedValue({ data: [{
      id: 'agent-special-owner', name: 'Codex', status: 'active', grants: [],
      owner: { id: 'owner-1', name: "Ops $& $` $'", email: 'ops@example.test' },
      _count: { credentials: 0, auditEvents: 1 },
    }] });
    render(<MemoryRouter><LanguageProvider><AgentList /></LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('link', { name: /Codex/ })).toHaveTextContent("Owner: Ops $& $` $' (ops@example.test)");
  });

  it('opens the public connection guide without precreating an Agent', async () => {
    render(<MemoryRouter initialEntries={['/agents']}><LanguageProvider>
      <Routes>
        <Route path="/agents" element={<AgentList />} />
        <Route path="/guide/agent-onboard" element={<h1>Agent onboarding guide</h1>} />
      </Routes>
    </LanguageProvider></MemoryRouter>);

    const connect = await screen.findByRole('link', { name: '接入智能体' });
    expect(connect).toHaveAttribute('href', '/guide/agent-onboard');
    fireEvent.click(connect);
    expect(screen.getByRole('heading', { name: 'Agent onboarding guide' })).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains a rate-limited list and retries without presenting it as empty', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce({ response: { status: 429, data: { message: 'Too many requests' } } })
      .mockResolvedValueOnce({ data: [{
        id: 'existing-agent', name: '已有智能体', status: 'active', grants: [],
        _count: { credentials: 1, auditEvents: 0 },
      }] });
    render(<MemoryRouter><LanguageProvider><AgentList /></LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('请求过于频繁，请稍后再试');
    expect(screen.queryByText('还没有智能体')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('link', { name: /已有智能体/ })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('shows reconnect only for active Agents flagged by the API', async () => {
    const base = { status: 'active', grants: [], _count: { credentials: 0, auditEvents: 0 } };
    vi.mocked(api.get).mockResolvedValue({ data: [
      { ...base, id: 'needs-reconnect', name: '待恢复助手', reconnectRequired: true },
      { ...base, id: 'legacy', name: '旧接口助手' },
      { ...base, id: 'connected', name: '现有助手', reconnectRequired: false },
      { ...base, id: 'paused', name: '暂停助手', status: 'paused', reconnectRequired: true },
      { ...base, id: 'archived', name: '归档助手', status: 'archived', reconnectRequired: true },
    ] });
    render(<MemoryRouter><LanguageProvider><AgentList /></LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('link', { name: /待恢复助手/ })).toHaveTextContent('需要重连');
    expect(screen.getByRole('link', { name: /旧接口助手/ })).toHaveTextContent('已启用');
    expect(screen.getByRole('link', { name: /现有助手/ })).toHaveTextContent('已启用');
    expect(screen.getByRole('link', { name: /暂停助手/ })).toHaveTextContent('已暂停');
    expect(screen.getAllByText('需要重连')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '查看已归档智能体' }));
    expect(await screen.findByRole('link', { name: /归档助手/ })).not.toHaveTextContent('需要重连');
  });

  it('closes manual creation with Escape and restores focus to its button', async () => {
    render(
      <MemoryRouter>
        <LanguageProvider><AgentList /></LanguageProvider>
      </MemoryRouter>,
    );

    const opener = await screen.findByRole('button', { name: '手动创建' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '创建智能体' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

it('requires confirmation to archive, hides archived Agents and restores them paused', async () => {
  localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  const agent = { id: 'idle', name: '闲置智能体', status: 'paused', grants: [], _count: { credentials: 0, auditEvents: 12 } };
  vi.mocked(api.get).mockResolvedValue({ data: [agent] });
  vi.mocked(api.post).mockImplementation(async (url) => {
    agent.status = String(url).endsWith('/archive') ? 'archived' : 'paused';
    return { data: agent };
  });
  render(<MemoryRouter><LanguageProvider><AgentList /></LanguageProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '归档' }));
  expect(api.post).not.toHaveBeenCalledWith('/agents/idle/archive');
  expect(screen.getByRole('dialog', { name: '归档智能体' })).toHaveTextContent('审计记录保留');
  fireEvent.click(screen.getByRole('button', { name: '确认归档' }));
  await waitFor(() => expect(screen.queryByText('闲置智能体')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '查看已归档智能体' }));
  fireEvent.click(await screen.findByRole('button', { name: '恢复为暂停' }));
  fireEvent.click(screen.getByRole('button', { name: '确认恢复为暂停' }));
  await waitFor(() => expect(agent.status).toBe('paused'));
});

it('keeps archive failure visible and cancel sends no request', async () => {
  vi.clearAllMocks();
  localStorage.setItem('agentwiki.language.v1', 'en');
  const agent = { id: 'idle', name: 'Idle', status: 'paused', grants: [], _count: { credentials: 1, auditEvents: 2 } };
  vi.mocked(api.get).mockResolvedValue({ data: [agent] });
  vi.mocked(api.post).mockRejectedValue(new Error('private-error'));
  render(<MemoryRouter><LanguageProvider><AgentList /></LanguageProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Action failed. Refresh and retry.');
  expect(screen.getByRole('dialog', { name: 'Archive Agent' })).toBeVisible();
  expect(screen.getByRole('link', { name: /Idle/ })).toBeVisible();
  expect(document.body).not.toHaveTextContent('private-error');
});
