import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('uses the unified connection card as the only editable authorization entry', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '访问权限' }));

    expect(screen.getAllByRole('combobox', { name: 'Agent 角色' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '授权' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建凭据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '空间访问权限' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '凭据' })).not.toBeInTheDocument();
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
