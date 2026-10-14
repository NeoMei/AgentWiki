import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

  it('closes with Escape and restores focus to the new-agent button', async () => {
    render(
      <MemoryRouter>
        <LanguageProvider><AgentList /></LanguageProvider>
      </MemoryRouter>,
    );

    const opener = await screen.findByRole('button', { name: '新建智能体' });
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
