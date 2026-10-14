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
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{
        id: 'space-1', name: '团队知识库',
        members: [{ userId: 'owner-1', role: 'owner' }],
      }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
  });

  it('shows tool, real target and result summary while labeling historical transport honestly', async () => {
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: { id: 'agent-1', name: '同步助手', status: 'active', grants: [], credentials: [] } };
      if (url.endsWith('/activity')) return { data: { data: [
        { id: 'new', action: 'mcp.tool.get_page', outcome: 'success', resourceType: 'Page', resourceId: 'page-1', createdAt: '2026-10-14T00:00:00Z', metadata: { resultSummary: { status: 'published' }, token: 'private-secret' } },
        { id: 'old', action: 'POST /api/mcp', outcome: 'success', createdAt: '2026-10-13T00:00:00Z' },
      ] } };
      return { data: { data: [] } };
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '活动记录' }));
    expect(screen.getByText(/get_page.*Page.*page-1.*成功/)).toBeVisible();
    expect(screen.getByText(/结果摘要.*已发布/)).toBeVisible();
    expect(screen.getByText(/历史记录未保存具体工具或目标/)).toBeVisible();
    expect(document.body).not.toHaveTextContent('private-secret');
  });

  it('shows task status and both relation endpoints without leaking extra metadata', async () => {
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: { id: 'agent-1', name: '同步助手', status: 'active', grants: [], credentials: [] } };
      if (url.endsWith('/activity')) return { data: { data: [
        { id: 'task', action: 'mcp.tool.update_taskboard_status', outcome: 'success', resourceType: 'TaskboardTask', resourceId: 'task-7', createdAt: '2026-10-14T00:00:00Z', metadata: { resultSummary: { taskStatus: 'in_progress', current_step: 'private-step' } } },
        { id: 'relation', action: 'mcp.tool.propose_relation', outcome: 'success', resourceType: 'PageRelation', resourceId: 'page-1', createdAt: '2026-10-14T00:00:00Z', metadata: { target: { type: 'PageRelation', id: 'page-1', targetPageId: 'page-2', relation: 'private-relation' }, resultSummary: { status: 'pending_review' } } },
      ] } };
      return { data: { data: [] } };
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '活动记录' }));
    expect(screen.getByText(/update_taskboard_status.*task-7/)).toBeVisible();
    expect(screen.getByText(/结果摘要.*进行中/)).toBeVisible();
    expect(screen.getByText(/propose_relation.*page-1.*page-2/)).toBeVisible();
    expect(document.body).not.toHaveTextContent('private-step');
    expect(document.body).not.toHaveTextContent('private-relation');
  });

  it.each([
    ['zh-CN', '活动记录', '已提交', '需要修复结果', '等待审核', '已导入: 2'],
    ['en', 'Activity', 'Submitted', 'Repair result required', 'Waiting for review', 'Imported: 2'],
  ])('renders distinct collaboration results and import counts in %s', async (language, tab, submitted, repair, waiting, imported) => {
    localStorage.setItem('agentwiki.language.v1', language);
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: { id: 'agent-1', name: '同步助手', status: 'active', grants: [], credentials: [] } };
      if (url.endsWith('/activity')) return { data: { data: [
        { id: 'submit', action: 'mcp.tool.collaboration_submit_result', outcome: 'success', createdAt: '2026-10-14T00:00:00Z', metadata: { resultSummary: { action: 'submitted', artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review', replayed: false, leaseToken: 'private-lease' } } },
        { id: 'repair', action: 'mcp.tool.collaboration_submit_result', outcome: 'success', createdAt: '2026-10-14T00:00:00Z', metadata: { resultSummary: { action: 'repair_result', repairsRemaining: 2, issueCount: 1, message: 'private-message' } } },
        { id: 'import', action: 'mcp.tool.import_taskboard_plans', outcome: 'failure', createdAt: '2026-10-14T00:00:00Z', metadata: { resultSummary: { imported: 2, failed: 1 } } },
      ] } };
      return { data: { data: [] } };
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: tab }));
    expect(screen.getByText(new RegExp(`${submitted}.*${waiting}`))).toBeVisible();
    expect(screen.getByText(new RegExp(repair))).toBeVisible();
    expect(screen.getByText(new RegExp(imported))).toBeVisible();
    expect(document.body).not.toHaveTextContent('private-');
  });

  it('offers direct Space authorization alongside the unified connection card', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    expect(screen.getAllByRole('combobox', { name: 'Agent 角色' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '授权此空间' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '创建凭据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '空间访问权限' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '凭据' })).not.toBeInTheDocument();
  });

  it('hides the old Agent while a new route loads and ignores old-entity actions', async () => {
    const nextAgent = deferred<any>();
    vi.mocked(api.get).mockReset().mockImplementation((url: string) => {
      if (url === '/agents/agent-1') return Promise.resolve({ data: {
        id: 'agent-1', name: 'Agent One', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [],
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
      approvalMode: 'always-review', grants: [], credentials: [],
    } }));
    expect(await screen.findByRole('heading', { name: 'Agent Two' })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Agent One' })).not.toBeInTheDocument());
  });

  it('offers connection authorization for every joined Space with the member role ceiling', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [],
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
      .toEqual(['我管理的空间', '我协管的空间', '我编辑的空间', '我只读的空间']);

    fireEvent.change(spaceSelect, { target: { value: 'edited' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent 角色' })).toHaveValue('editor'));
    expect(within(screen.getByRole('combobox', { name: 'Agent 角色' })).getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(['reader', 'editor']);

    fireEvent.change(spaceSelect, { target: { value: 'viewed' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent 角色' })).toHaveValue('reader'));
    expect(within(screen.getByRole('combobox', { name: 'Agent 角色' })).getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(['reader']);
  });

  it('requires real membership for platform super administrator Space choices', async () => {
    localStorage.setItem('user', JSON.stringify({
      id: 'admin-1', email: 'admin@example.test', platformRole: 'super_admin',
    }));
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [],
      } } as any)
      .mockResolvedValueOnce({ data: { data: [
        { id: 'unjoined', name: '超管未加入的空间', members: [] },
        { id: 'viewed', name: '超管只读成员空间', members: [{ userId: 'admin-1', role: 'viewer' }] },
      ] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    const spaceSelect = screen.getByRole('combobox', { name: '空间' });
    expect(spaceSelect).not.toBeDisabled();
    expect(within(spaceSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['超管只读成员空间']);
    expect(screen.getByRole('combobox', { name: 'Agent 角色' })).toHaveValue('reader');
  });

  it('loads every Space page before building the authorization choices', async () => {
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [],
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
        approvalMode: 'always-review', grants: [], credentials: [],
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
        approvalMode: 'always-review', grants: [],
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
        credentials: [],
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{ id: 'space-1', name: '团队知识库' }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    const grants = screen.getByRole('heading', { name: '已授权空间' }).closest('section');
    expect(grants).not.toBeNull();
    expect(within(grants!).getByText('团队知识库')).toBeInTheDocument();
    expect(within(grants!).getByText('读者')).toBeInTheDocument();
    expect(within(grants!).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(grants!).getByRole('button', { name: '移除团队知识库授权' })).toBeInTheDocument();
  });

  it.each([
    ['zh-CN', 'always-review', '遵循空间策略', '设置'],
    ['zh-CN', 'scoped-auto-publish', '遵循空间策略', '设置'],
    ['en', 'always-review', 'Follows Space policy', 'Settings'],
    ['en', 'scoped-auto-publish', 'Follows Space policy', 'Settings'],
  ])('shows Space-governed approval in %s regardless of legacy Agent mode %s', async (language, approvalMode, policy, settings) => {
    localStorage.setItem('agentwiki.language.v1', language);
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: {
        id: 'agent-1', name: '同步助手', status: 'active', approvalMode, grants: [], credentials: [],
      } };
      return { data: { data: [] } };
    });
    renderDetail();

    expect(await screen.findByText(policy)).toBeInTheDocument();
    expect(screen.queryByText(/^(始终审核|无需审核|Always review|No review)$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: settings }));

    expect(screen.getByText(policy)).toBeInTheDocument();
    expect(screen.queryByText(/^(始终审核|无需审核|Always review|No review)$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders identity connection records separately from each Space role with an accessible revoke action', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'scoped-auto-publish', grants: [
          { id: 'grant-1', spaceId: 'space-1', role: 'publisher', space: { id: 'space-1', name: '团队知识库' } },
          { id: 'grant-2', spaceId: 'space-2', role: 'editor', space: { id: 'space-2', name: '项目管理' } },
        ],
        credentials: [{
          id: 'credential-1', name: 'Deploy key', prefix: 'agk_preview',
          credentialScope: 'agent', active: true,
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
    expect(credentialRow).toHaveTextContent('Agent 身份连接');
    expect(credentialRow).not.toHaveTextContent('团队知识库');
    const grants = screen.getByRole('heading', { name: '已授权空间' }).closest('section')!;
    expect(within(grants).getByText('团队知识库').parentElement).toHaveTextContent('发布者');
    expect(within(grants).getByText('项目管理').parentElement).toHaveTextContent('编辑者');
    expect(grants).not.toHaveTextContent('每个连接凭证仅绑定');
    expect(grants).toHaveTextContent('按空间 ID 实时校验');
    expect(credentialRow).toHaveTextContent('agk_preview…');
    expect(credentialRow).toHaveTextContent('上次使用: 从未');
    expect(credentialRow).toHaveTextContent('到期时间:');
    expect(credentialRow).toHaveTextContent('有效');
  });


  it.each([
    ['paused', 'Agent 已暂停；有效身份凭据仍保留'],
    ['active', '当前客户端的连接状态尚未验证'],
  ])('does not infer current-client connectivity from a credential when Agent is %s', async (status, message) => {
    vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => {
      if (url === '/agents/agent-1') return { data: {
        id: 'agent-1', name: '同步助手', status, approvalMode: 'always-review',
        grants: [{ id: 'grant-1', spaceId: 'space-1', role: 'editor', space: { id: 'space-1', name: '团队知识库' } }],
        credentials: [{ id: 'credential-1', name: 'Desktop', prefix: 'agk_test', credentialScope: 'agent', active: true, expiresAt: null }],
      } } as any;
      if (url.startsWith('/spaces?')) return { data: { data: [{ id: 'space-1', name: '团队知识库', members: [{ userId: 'owner-1', role: 'owner' }] }] } } as any;
      return { data: { data: [] } } as any;
    });
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    const state = screen.getByRole('status');
    expect(state).toHaveTextContent(message);
    expect(state).not.toHaveTextContent('可通过现有连接访问');
    expect(state).not.toHaveClass('bg-green-50');
    expect(screen.getByRole('button', { name: '为另一客户端生成接入指令' })).toBeInTheDocument();
  });

  it('counts only unrevoked and unexpired credentials as active', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [],
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
