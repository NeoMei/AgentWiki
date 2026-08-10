import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  agentScopes?: string[];
}

const membersFor = (
  role: FixtureOptions['role'] = 'owner',
  agentScopes: string[] = ['pages:read'],
) => [
  {
    id: 'current-member', type: 'human', userId: 'user-1', role,
    user: { id: 'user-1', email: 'current@example.com', name: 'Current', type: 'human' },
    createdAt: '2026-07-30T00:00:00.000Z',
  },
  {
    id: 'grant-1', type: 'agent', agentId: 'agent-existing', role: 'viewer', scopes: agentScopes,
    agent: { id: 'agent-existing', name: 'Existing', status: 'active' },
    createdAt: '2026-07-30T00:00:00.000Z',
  },
];

const renderMembers = ({ role = 'owner', agentScopes }: FixtureOptions = {}) => {
  vi.mocked(api.get).mockImplementation((url) => {
    if (url === '/spaces/space-1/members') return Promise.resolve({ data: membersFor(role, agentScopes) });
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

  it('does not present an unsafe deselect-all action when every scope is selected', async () => {
    renderMembers({
      agentScopes: [
        'pages:read', 'pages:write', 'sources:read', 'sources:write',
        'runs:read', 'runs:write', 'review:read', 'review:auto-publish',
        'memory:read', 'memory:write', 'graph:read', 'graph:write',
      ],
    });

    fireEvent.click(await screen.findByTitle('权限设置'));

    expect(screen.getByRole('button', { name: '已全选' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '取消全选' })).not.toBeInTheDocument();
  });
});
