import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { CreatePageTemplateDialog } from './CreatePageTemplateDialog';
import type { PageTemplateSourcePageListResponse } from './pageTemplateTypes';

const mocks = vi.hoisted(() => ({ listPageTemplateSourcePages: vi.fn(), createPageTemplate: vi.fn() }));
vi.mock('./pageTemplateApi', () => mocks);
const page = { id: 'page-1', title: '团队周报', format: 'markdown' as const, path: '研发 / 周报', updatedAt: '2026-10-19T09:00:00.000Z' };
const catalog = { data: [page], total: 1, skip: 0, take: 100 };
const onSaved = vi.fn();
const renderDialog = () => render(<LanguageProvider><CreatePageTemplateDialog spaceId="space-1" onClose={vi.fn()} onSaved={onSaved} /></LanguageProvider>);

describe('CreatePageTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.listPageTemplateSourcePages.mockResolvedValue(catalog);
  });

  it('creates a custom template from the selected saved-page timestamp', async () => {
    const saved = { id: 'template-1', name: page.title };
    mocks.createPageTemplate.mockResolvedValue(saved);
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /团队周报 研发/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存为 Space 模板' }));
    expect(screen.getByLabelText('模板名称')).toHaveValue(page.title);
    await waitFor(() => expect(screen.getByLabelText('模板名称')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
    await waitFor(() => expect(mocks.createPageTemplate).toHaveBeenCalledWith('space-1', {
      name: page.title, description: undefined, category: 'other', defaultTitle: page.title,
      locale: 'zh-CN', sourcePageId: page.id, expectedSourceUpdatedAt: page.updatedAt,
    }));
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('clears the old selection during search and ignores a late old query', async () => {
    let resolveOld!: (value: PageTemplateSourcePageListResponse) => void;
    mocks.listPageTemplateSourcePages.mockImplementation((_id, options) => options.q === 'older'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(options.q ? { ...catalog, data: [{ ...page, id: 'page-2', title: '目标页面' }] } : catalog));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /团队周报 研发/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'older' } });
    expect(screen.getByRole('button', { name: '保存为 Space 模板' })).toBeDisabled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'target' } });
    expect(await screen.findByRole('button', { name: /目标页面/ })).toBeInTheDocument();
    await act(async () => resolveOld(catalog));
    expect(screen.queryByRole('button', { name: /团队周报 研发/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存为 Space 模板' })).toBeDisabled();
  });

  it('loads later source pages and retries the current failed page', async () => {
    mocks.listPageTemplateSourcePages.mockResolvedValueOnce({ ...catalog, total: 101 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...catalog, skip: 100, total: 101, data: [{ ...page, id: 'last', title: '最后页面' }] });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接失败，请稍后重试');
    expect(screen.getByRole('button', { name: '保存为 Space 模板' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: /最后页面/ })).toBeInTheDocument();
    expect(mocks.listPageTemplateSourcePages).toHaveBeenLastCalledWith('space-1', { skip: 100, take: 100 });
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });
});
