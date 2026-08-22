import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentDetail } from './AgentDetail';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const renderDetail = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/agents/agent-1']}>
      <Routes><Route path="/agents/:id" element={<AgentDetail />} /></Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

describe('AgentDetail', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
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
      .mockResolvedValueOnce({ data: { data: [{ id: 'space-1', name: '团队知识库' }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
  });

  it('places local knowledge sync between space grants and credentials', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    const spaceAccess = screen.getByRole('heading', { name: '空间访问权限' });
    const localSync = screen.getByRole('heading', { name: 'AgentWiki 统一网关' });
    const credentials = screen.getByRole('heading', { name: '凭据' });
    expect(screen.getByRole('button', { name: '创建凭据' })).toBeInTheDocument();
    expect(spaceAccess.compareDocumentPosition(localSync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(localSync.compareDocumentPosition(credentials) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a newly created API credential without advertising a second MCP connection', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { apiKey: 'agk_api_only_secret' } } as any);
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'always-review', grants: [], credentials: [], memoryEnabled: false,
      } } as any)
      .mockResolvedValueOnce({ data: { data: [{ id: 'space-1', name: '团队知识库' }] } } as any)
      .mockResolvedValueOnce({ data: { data: [] } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    fireEvent.click(screen.getByRole('button', { name: '创建凭据' }));

    expect(await screen.findByText('agk_api_only_secret')).toBeInTheDocument();
    const credentials = screen.getByRole('heading', { name: '凭据' }).closest('section');
    expect(credentials).not.toBeNull();
    expect(within(credentials!).queryByText(/一键接入指令|复制接入指令|MCP 连接名|mcp add/i)).not.toBeInTheDocument();
    expect(within(credentials!).getByText(/API、脚本或外部系统/)).toBeInTheDocument();
  });

  it('sends only the publisher role when granting Space access', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    const spaceAccess = screen.getByRole('heading', { name: '空间访问权限' }).closest('section');
    expect(spaceAccess).not.toBeNull();
    fireEvent.change(within(spaceAccess!).getByRole('combobox', { name: '知识空间' }), { target: { value: 'space-1' } });
    fireEvent.change(within(spaceAccess!).getByRole('combobox', { name: 'Agent 角色' }), { target: { value: 'publisher' } });
    fireEvent.click(within(spaceAccess!).getByRole('button', { name: '授权' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/agents/agent-1/grants/space-1',
      { role: 'publisher' },
    ));
  });

  it('creates a reader credential without editable scopes', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { apiKey: 'agk_reader_secret' } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    const credentials = screen.getByRole('heading', { name: '凭据' }).closest('section');
    expect(credentials).not.toBeNull();
    expect(within(credentials!).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(within(credentials!).getByRole('button', { name: '创建凭据' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/agents/agent-1/credentials',
      { name: 'Default credential', role: 'reader' },
    ));
  });

  it('updates an existing Space grant from its role selector', async () => {
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
    vi.mocked(api.put).mockResolvedValue({ data: {} } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    fireEvent.change(screen.getByRole('combobox', { name: '团队知识库的 Agent 角色' }), {
      target: { value: 'editor' },
    });

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/agents/agent-1/grants/space-1',
      { role: 'editor' },
    ));
  });

  it('shows approval mode as a read-only diagnostic', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '设置' }));

    expect(screen.getByText('始终审核')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows credential role and lifecycle diagnostics with an accessible revoke action', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValueOnce({ data: {
        id: 'agent-1', name: '同步助手', description: '', status: 'active',
        approvalMode: 'scoped-auto-publish', grants: [], memoryEnabled: true,
        credentials: [{
          id: 'credential-1', name: 'Deploy key', prefix: 'agk_preview', role: 'publisher',
          scopes: ['pages:read', 'pages:write', 'review:auto-publish'],
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
    expect(credentialRow).toHaveTextContent('Publisher');
    expect(credentialRow).toHaveTextContent('agk_preview…');
    expect(credentialRow).toHaveTextContent('上次使用: 从未');
    expect(credentialRow).toHaveTextContent('到期时间:');
    expect(credentialRow).toHaveTextContent('有效');
  });

  it('reports one-time key copy only after the clipboard write succeeds', async () => {
    let resolveCopy: (() => void) | undefined;
    vi.mocked(navigator.clipboard.writeText).mockReturnValue(new Promise<void>((resolve) => { resolveCopy = resolve; }));
    vi.mocked(api.post).mockResolvedValue({ data: { apiKey: 'agk_delayed_secret' } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    fireEvent.click(screen.getByRole('button', { name: '创建凭据' }));
    const copy = await screen.findByRole('button', { name: '复制新凭据密钥' });
    fireEvent.click(copy);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('agk_delayed_secret');
    expect(screen.queryByRole('button', { name: '已复制新凭据密钥' })).not.toBeInTheDocument();
    resolveCopy?.();
    expect(await screen.findByRole('button', { name: '已复制新凭据密钥' })).toBeInTheDocument();
  });

  it('reports clipboard failure and resets copied state for a newly created key', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { apiKey: 'agk_first_secret' } } as any)
      .mockResolvedValueOnce({ data: { apiKey: 'agk_second_secret' } } as any);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));
    fireEvent.click(screen.getByRole('button', { name: '创建凭据' }));
    fireEvent.click(await screen.findByRole('button', { name: '复制新凭据密钥' }));
    expect(await screen.findByRole('button', { name: '已复制新凭据密钥' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建凭据' }));
    expect(await screen.findByText('agk_second_secret')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制新凭据密钥' })).toBeInTheDocument();

    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: '复制新凭据密钥' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制密钥失败');
    expect(screen.getByRole('button', { name: '复制新凭据密钥' })).toBeInTheDocument();
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
