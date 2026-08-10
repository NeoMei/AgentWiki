import { fireEvent, render, screen } from '@testing-library/react';
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
    const localSync = screen.getByRole('heading', { name: '本地知识同步' });
    const credentials = screen.getByRole('heading', { name: '凭据' });
    expect(screen.getByRole('button', { name: '创建凭据' })).toBeInTheDocument();
    expect(spaceAccess.compareDocumentPosition(localSync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(localSync.compareDocumentPosition(credentials) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
