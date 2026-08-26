import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import type { PageTemplateListResponse } from './pageTemplateTypes';
import { PageTemplateSettingsCard } from './PageTemplateSettingsCard';

const mocks = vi.hoisted(() => ({ listPageTemplates: vi.fn() }));
vi.mock('./pageTemplateApi', () => ({ listPageTemplates: mocks.listPageTemplates }));

const catalog: PageTemplateListResponse = {
  system: [],
  space: [],
  totalSpace: 3,
  skip: 0,
  take: 1,
  capabilities: { canManage: true },
};

const LanguageSwitch = () => {
  const { setLanguage } = useLanguage();
  return <button type="button" onClick={() => setLanguage('en')}>Switch language</button>;
};

describe('PageTemplateSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('shows the active Space template count and manage link only when allowed', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    render(<LanguageProvider><MemoryRouter><PageTemplateSettingsCard spaceId="space-1" /></MemoryRouter></LanguageProvider>);

    expect(await screen.findByText('已启用 3/100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '管理模板' })).toHaveAttribute(
      'href', '/spaces/space-1/settings/page-templates',
    );
    expect(mocks.listPageTemplates).toHaveBeenCalledWith('space-1', {
      locale: 'zh-CN', scope: 'space', take: 1,
    });
  });

  it('keeps a read-only count but hides management when capability is false', async () => {
    mocks.listPageTemplates.mockResolvedValue({ ...catalog, capabilities: { canManage: false } });
    render(<LanguageProvider><MemoryRouter><PageTemplateSettingsCard spaceId="space-1" /></MemoryRouter></LanguageProvider>);

    expect(await screen.findByText('已启用 3/100')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理模板' })).not.toBeInTheDocument();
  });

  it('isolates its load failure and ignores a stale language response', async () => {
    let resolveChinese!: (value: PageTemplateListResponse) => void;
    let rejectEnglish!: (reason: unknown) => void;
    mocks.listPageTemplates.mockImplementation((_spaceId: string, options: { locale: string }) => (
      options.locale === 'zh-CN'
        ? new Promise((resolve) => { resolveChinese = resolve; })
        : new Promise((_resolve, reject) => { rejectEnglish = reject; })
    ));
    render(<LanguageProvider><MemoryRouter><LanguageSwitch /><PageTemplateSettingsCard spaceId="space-1" /></MemoryRouter></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    await waitFor(() => expect(rejectEnglish).toBeTypeOf('function'));
    await act(async () => rejectEnglish(new Error('offline')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Template management details could not be loaded');

    await act(async () => resolveChinese(catalog));
    expect(screen.queryByText('3/100 active')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Template management details could not be loaded');
  });

  it('retries a failed settings-card request in place', async () => {
    mocks.listPageTemplates.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);
    render(<LanguageProvider><MemoryRouter><PageTemplateSettingsCard spaceId="space-1" /></MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('模板管理信息加载失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('link', { name: '管理模板' })).toBeInTheDocument();
    expect(mocks.listPageTemplates).toHaveBeenCalledTimes(2);
  });
});
