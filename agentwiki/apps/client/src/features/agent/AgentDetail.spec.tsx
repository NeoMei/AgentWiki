import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { AuthProvider } from '../../context/AuthContext';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentDetail } from './AgentDetail';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const renderDetail = () => render(
  <LanguageProvider>
    <AuthProvider>
      <MemoryRouter initialEntries={['/agents/agent-1']}>
        <Routes><Route path="/agents/:id" element={<AgentDetail />} /></Routes>
      </MemoryRouter>
    </AuthProvider>
  </LanguageProvider>,
);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const NavigableDetail = () => {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate('/agents/agent-2')}>Switch agent</button><AgentDetail /></>;
};

describe('AgentDetail', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-1', email: 'owner@example.test' }));
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: {
        id: 'agent-1',
        name: '同步助手',
        description: '',
        status: 'active',
        approvalMode: 'always-review',
        grants: [],
        credentials: [],
        memoryEnabled: false,
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{
        id: 'space-1', name: '团队知识库',
        members: [{ userId: 'owner-1', role: 'owner' }],
      }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
  });

  it('uses the unified connection card as the only editable authorization entry', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    expect(screen.getAllByRole('combobox', { name: 'Agent 角色' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '授权' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建凭据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '空间访问权限' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '凭据' })).not.toBeInTheDocument();
  });

  it('hides the old Agent while a new route loads and ignores old-entity actions', async () => {
    const nextAgent = deferred<any>();
    vi.mocked(api.get).mockReset().mockImplementation((url: string) => {
      if (url === '/agents/agent-1') return Promise.resolve({ data: {
        id: 'agent-1', name: 'Agent One', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
      } });
      if (url === '/agents/agent-2') return nextAgent.promise;
      if (url.startsWith('/spaces?')) return Promise.resolve({ data: { data: [] } });
      if (url.endsWith('/activity')) return Promise.resolve({ data: { data: [] } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    render(
      <LanguageProvider><AuthProvider><MemoryRouter initialEntries={['/agents/agent-1']}>
        <Routes><Route path="/agents/:id" element={<NavigableDetail />} /></Routes>
      </MemoryRouter></AuthProvider></LanguageProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Agent One' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch agent' }));

    expect(screen.queryByRole('heading', { name: 'Agent One' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂停' })).not.toBeInTheDocument();
    await act(async () => nextAgent.resolve({ data: {
      id: 'agent-2', name: 'Agent Two', description: '', status: 'paused',
      approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
    } }));
    expect(await screen.findByRole('heading', { name: 'Agent Two' })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Agent One' })).not.toBeInTheDocument());
  });

  it('offers connection authorization only for Spaces the Agent owner can administer', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
      } } as any)
      .mockResolvedValueOnce({ data: { data: [
        { id: 'owned', name: '我管理的空间', members: [{ userId: 'owner-1', role: 'owner' }] },
        { id: 'admin', name: '我协管的空间', members: [{ userId: 'owner-1', role: 'admin' }] },
        { id: 'edited', name: '我编辑的空间', members: [{ userId: 'owner-1', role: 'editor' }] },
        { id: 'viewed', name: '我只读的空间', members: [{ userId: 'owner-1', role: 'viewer' }] },
      ] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    const spaceSelect = screen.getByRole('combobox', { name: '空间' });
    expect(within(spaceSelect).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['我管理的空间', '我协管的空间']);
  });

  it('offers every returned Space to a platform super administrator', async () => {
    localStorage.setItem('user', JSON.stringify({
      id: 'admin-1', email: 'admin@example.test', platformRole: 'super_admin',
    }));
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
      } } as any)
      .mockResolvedValueOnce({ data: { data: [
        { id: 'unjoined', name: '超管未加入的空间', members: [] },
        { id: 'viewed', name: '超管只读成员空间', members: [{ userId: 'admin-1', role: 'viewer' }] },
      ] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    const spaceSelect = screen.getByRole('combobox', { name: '空间' });
    expect(within(spaceSelect).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['超管未加入的空间', '超管只读成员空间']);
  });

  it('loads every Space page before building the authorization choices', async () => {
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
      } } as any;
      if (url === '/agents/agent-1/activity') return { data: { data: [] } } as any;
      if (url === '/spaces?take=100') return { data: {
        data: [{ id: 'space-new', name: '较新管理空间', members: [{ userId: 'owner-1', role: 'owner' }] }],
        hasMore: true,
        nextCursor: 'next page',
      } } as any;
      if (url === '/spaces?take=100&cursor=next%20page') return { data: {
        data: [{ id: 'space-old', name: '较旧管理空间', members: [{ userId: 'owner-1', role: 'admin' }] }],
        hasMore: false,
        nextCursor: null,
      } } as any;
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    const spaceSelect = screen.getByRole('combobox', { name: '空间' });
    expect(within(spaceSelect).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['较新管理空间', '较旧管理空间']);
  });

  it('discards stale pages and continues from a server-requested pagination reset', async () => {
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
      } } as any;
      if (url === '/agents/agent-1/activity') return { data: { data: [] } } as any;
      if (url === '/spaces?take=100') return { data: {
        data: [{ id: 'stale', name: '已过期页', members: [{ userId: 'owner-1', role: 'owner' }] }],
        hasMore: true, nextCursor: 'expired',
      } } as any;
      if (url === '/spaces?take=100&cursor=expired') return { data: {
        data: [{ id: 'fresh-1', name: '重置后首页', members: [{ userId: 'owner-1', role: 'owner' }] }],
        resetRequired: true, hasMore: true, nextCursor: 'fresh',
      } } as any;
      if (url === '/spaces?take=100&cursor=fresh') return { data: {
        data: [{ id: 'fresh-2', name: '重置后次页', members: [{ userId: 'owner-1', role: 'admin' }] }],
        hasMore: false, nextCursor: null,
      } } as any;
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    const options = within(screen.getByRole('combobox', { name: '空间' }))
      .getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['重置后首页', '重置后次页']);
    expect(options).not.toContain('已过期页');
  });

  it('renders an actionable error when revoking a connection fails', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], memoryEnabled: false,
        credentials: [{
          id: 'credential-1', name: 'Deploy key', prefix: 'agk_preview',
          authorization: { id: 'grant-1', role: 'editor', scopes: [], space: { id: 'space-1', name: '团队知识库' } },
          lastUsedAt: null, expiresAt: null,
        }],
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{
        id: 'space-1', name: '团队知识库', members: [{ userId: 'owner-1', role: 'owner' }],
      }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    vi.mocked(api.delete).mockRejectedValue({ response: { data: { message: '凭据已被其他操作撤销' } } });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销Deploy key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('凭据已被其他操作撤销');
  });

  it('renders an actionable error when pausing the Agent fails', async () => {
    vi.mocked(api.patch).mockRejectedValue({ response: { data: { message: '暂停操作被服务器拒绝' } } });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '暂停' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('暂停操作被服务器拒绝');
  });

  it('shows an existing Space authorization as a revocable record without another role selector', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review',
        grants: [{ id: 'grant-1', spaceId: 'space-1', role: 'reader', space: { id: 'space-1', name: '团队知识库' } }],
        credentials: [], memoryEnabled: false,
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{ id: 'space-1', name: '团队知识库' }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    const grants = screen.getByRole('heading', { name: '已授权空间' }).closest('section');
    expect(grants).not.toBeNull();
    expect(within(grants!).getByText('团队知识库')).toBeInTheDocument();
    expect(within(grants!).getByText('Reader')).toBeInTheDocument();
    expect(within(grants!).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(grants!).getByRole('button', { name: '移除团队知识库授权' })).toBeInTheDocument();
  });

  it('shows approval mode as a read-only diagnostic', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '设置' }));

    expect(screen.getByText('始终审核')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the Space authorization bound to a connection record with an accessible revoke action', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'scoped-auto-publish', grants: [], memoryEnabled: true,
        credentials: [{
          id: 'credential-1', name: 'Deploy key', prefix: 'agk_preview',
          authorization: { id: 'grant-1', role: 'publisher', scopes: ['pages:read', 'pages:write', 'review:auto-publish'], space: { id: 'space-1', name: '团队知识库' } },
          lastUsedAt: null, expiresAt: '2030-01-01T00:00:00.000Z',
        }],
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{ id: 'space-1', name: '团队知识库' }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    const revoke = screen.getByRole('button', { name: '撤销Deploy key' });
    const credentialRow = revoke.closest('div');
    expect(credentialRow).not.toBeNull();
    expect(credentialRow).toHaveTextContent('Deploy key');
    expect(credentialRow).toHaveTextContent('团队知识库');
    expect(credentialRow).toHaveTextContent('Publisher');
    expect(credentialRow).toHaveTextContent('agk_preview…');
    expect(credentialRow).toHaveTextContent('上次使用: 从未');
    expect(credentialRow).toHaveTextContent('到期时间:');
    expect(credentialRow).toHaveTextContent('有效');
  });

  it('counts only unrevoked and unexpired credentials as active', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], memoryEnabled: false,
        credentials: [
          { id: 'active-no-expiry', revokedAt: null, expiresAt: null },
          { id: 'active-future', revokedAt: null, expiresAt: '2099-01-01T00:00:00.000Z' },
          { id: 'expired', revokedAt: null, expiresAt: '2020-01-01T00:00:00.000Z' },
          { id: 'revoked', revokedAt: '2026-01-01T00:00:00.000Z', expiresAt: null },
        ],
      } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    const summary = (await screen.findByText('有效凭据')).parentElement;
    expect(summary).toHaveTextContent('2');
  });
});
