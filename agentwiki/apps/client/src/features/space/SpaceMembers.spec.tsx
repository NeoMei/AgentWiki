import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { SpaceMembers } from './SpaceMembers';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: vi.fn() }));
vi.mock('../../components/SpaceNav', () => ({ SpaceNav: () => <div>Space navigation</div> }));

interface FixtureOptions {
  role?: 'owner' | 'admin' | 'editor';
  agentRole?: 'reader' | 'editor' | 'publisher';
  canManageAgentRole?: boolean;
}

const membersFor = (
  role: FixtureOptions['role'] = 'owner',
  agentRole: FixtureOptions['agentRole'] = 'reader',
  canManageAgentRole = true,
) => [
  {
    id: 'current-member', type: 'human', userId: 'user-1', role,
    user: { id: 'user-1', email: 'current@example.com', name: 'Current', type: 'human' },
    createdAt: '2026-07-30T00:00:00.000Z',
  },
  {
    id: 'teammate-member', type: 'human', userId: 'user-2', role: 'viewer',
    user: { id: 'user-2', email: 'teammate@example.com', name: 'Teammate', type: 'human' },
    createdAt: '2026-07-30T00:00:00.000Z',
  },
  {
    id: 'grant-1', type: 'agent', agentId: 'agent-existing', role: agentRole, canManageRole: canManageAgentRole,
    agent: { id: 'agent-existing', name: 'Existing', status: 'active' },
    createdAt: '2026-07-30T00:00:00.000Z',
  },
];

const renderMembers = ({ role = 'owner', agentRole, canManageAgentRole = true }: FixtureOptions = {}) => {
  vi.mocked(api.get).mockImplementation((url) => {
    if (url === '/spaces/space-1/members') return Promise.resolve({ data: membersFor(role, agentRole, canManageAgentRole) });
    if (url === '/agents') return Promise.resolve({ data: [
      { id: 'agent-existing', name: 'Existing', status: 'active', revokedAt: null },
      { id: 'agent-new', name: 'New', status: 'active', revokedAt: null },
    ] });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  return render(
    <MemoryRouter initialEntries={['/spaces/space-1/members']}>
      <Routes><Route path="/spaces/:id/members" element={<SpaceMembers />} /></Routes>
    </MemoryRouter>,
  );
};

const NavigableMembers = () => {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate('/spaces/space-2/members')}>Switch space</button><SpaceMembers /></>;
};

describe('SpaceMembers Agent addition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(useLanguage).mockReturnValue({ language: 'zh-CN' } as ReturnType<typeof useLanguage>);
  });

  afterEach(cleanup);

  it('opens the unified dialog for an owner and excludes existing agent grants', async () => {
    renderMembers();

    fireEvent.click(await screen.findByRole('button', { name: '添加成员' }));
    fireEvent.click(screen.getByRole('button', { name: '智能体' }));

    expect(await screen.findByRole('option', { name: 'New · 已启用' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Existing/ })).not.toBeInTheDocument();
  });

  it('shows the unified Add member entry to a space admin', async () => {
    renderMembers({ role: 'admin' });

    expect(await screen.findByRole('button', { name: '添加成员' })).toBeInTheDocument();
  });

  it('does not show the Add member entry to a space editor', async () => {
    renderMembers({ role: 'editor' });

    await screen.findByText('Current');
    expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument();
  });

  it('updates an Agent grant with one canonical role and no scopes', async () => {
    renderMembers();

    const role = await screen.findByRole('combobox', { name: 'Existing 的 Agent 角色' });
    expect(Array.from(role.querySelectorAll('option')).map((option) => option.value))
      .toEqual(['reader', 'editor', 'publisher']);
    fireEvent.change(role, { target: { value: 'publisher' } });

    await vi.waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/agents/agent-existing/grants/space-1',
      { role: 'publisher' },
    ));
    const agentRow = screen.getByTestId('member-agent-agent-existing');
    expect(agentRow.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(agentRow).not.toHaveTextContent(/审核者|完全授权|scopes|权限范围/i);
  });

  it('renders another users Agent grant as read-only for a Space admin', async () => {
    renderMembers({ role: 'admin', agentRole: 'publisher', canManageAgentRole: false });

    const agentRow = await screen.findByTestId('member-agent-agent-existing');
    expect(screen.queryByRole('combobox', { name: 'Existing 的 Agent 角色' })).not.toBeInTheDocument();
    expect(agentRow).toHaveTextContent('Publisher');
    expect(agentRow.querySelector('button[title="移除授权"]')).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('keeps human membership roles on the human endpoint', async () => {
    renderMembers();

    const humanRole = await screen.findByRole('combobox', { name: 'Teammate 的成员角色' });
    expect(Array.from(humanRole.querySelectorAll('option')).map((option) => option.value))
      .toEqual(['owner', 'admin', 'editor', 'viewer']);
    fireEvent.change(humanRole, { target: { value: 'editor' } });

    await vi.waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/spaces/space-1/members/user-2',
      { role: 'editor' },
    ));
  });

  it('removes old Space permissions immediately while the next member list loads', async () => {
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/spaces/space-1/members') return Promise.resolve({ data: membersFor('owner') });
      if (url === '/spaces/space-2/members') return new Promise(() => undefined);
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/members']}>
        <Routes><Route path="/spaces/:id/members" element={<NavigableMembers />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '添加成员' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));

    expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument();
    expect(screen.queryByText('Teammate')).not.toBeInTheDocument();
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });
});
