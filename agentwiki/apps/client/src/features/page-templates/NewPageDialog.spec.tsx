import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import type { PageTemplateListResponse, PageTemplateSummary } from './pageTemplateTypes';
import { NewPageDialog } from './NewPageDialog';

const mocks = vi.hoisted(() => ({
  api: { post: vi.fn() },
  listPageTemplates: vi.fn(),
  getContentTreeRevision: vi.fn(),
}));

vi.mock('../../api/client', () => ({ default: mocks.api }));
vi.mock('./pageTemplateApi', () => ({ listPageTemplates: mocks.listPageTemplates }));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: mocks.getContentTreeRevision }));

const systemWeekly: PageTemplateSummary = {
  id: 'system-weekly',
  scope: 'system',
  stableKey: 'weekly',
  category: 'reporting',
  name: '周报',
  description: '每周进展、问题和计划',
  defaultTitle: '周报 {year}年第{week}周',
  sourceLocale: null,
  currentVersion: 1,
  archivedAt: null,
  updatedAt: '2026-08-25T10:00:00.000Z',
};

const systemTasks: PageTemplateSummary = {
  ...systemWeekly,
  id: 'system-tasks',
  stableKey: 'tasks',
  category: 'planning',
  name: '任务清单',
  description: '跟踪待办事项',
  defaultTitle: '任务清单 {date}',
};

const spaceTemplate: PageTemplateSummary = {
  ...systemWeekly,
  id: 'space-weekly',
  scope: 'space',
  stableKey: 'team-weekly',
  name: '团队周报',
  description: '团队自定义周报',
  defaultTitle: '团队周报',
  sourceLocale: 'zh-CN',
};

const catalog: PageTemplateListResponse = {
  system: [systemWeekly, systemTasks],
  space: [spaceTemplate],
  totalSpace: 1,
  skip: 0,
  take: 100,
  capabilities: { canManage: true },
};

const parentOptions = [{ id: 'parent-1', title: '上级页面' }];

const renderDialog = (overrides: Partial<React.ComponentProps<typeof NewPageDialog>> = {}) => {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const result = render(
    <LanguageProvider>
      <MemoryRouter>
        <NewPageDialog
          spaceId="space-1"
          parentOptions={parentOptions}
          onClose={onClose}
          onCreated={onCreated}
          now={new Date(2026, 7, 25, 12)}
          {...overrides}
        />
      </MemoryRouter>
    </LanguageProvider>,
  );
  return { ...result, onClose, onCreated };
};

const DeferredCatalogHarness: React.FC = () => {
  const [spaceId, setSpaceId] = useState('space-old');
  return <LanguageProvider><MemoryRouter>
    <button type="button" onClick={() => setSpaceId('space-new')}>Switch space</button>
    <NewPageDialog
      spaceId={spaceId}
      parentOptions={[]}
      onClose={() => undefined}
      onCreated={() => undefined}
      now={new Date(2026, 7, 25, 12)}
    />
  </MemoryRouter></LanguageProvider>;
};

const LanguageIdentityControls: React.FC = () => {
  const { setLanguage } = useLanguage();
  return <button type="button" onClick={() => setLanguage('en')}>Switch language</button>;
};

const LanguageIdentityHarness: React.FC = () => (
  <LanguageProvider><MemoryRouter>
    <LanguageIdentityControls />
    <NewPageDialog
      spaceId="space-1"
      parentOptions={parentOptions}
      onClose={() => undefined}
      onCreated={() => undefined}
      now={new Date(2026, 7, 25, 12)}
    />
  </MemoryRouter></LanguageProvider>
);

const OpenerHarness: React.FC = () => {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return <LanguageProvider><MemoryRouter>
    <button ref={openerRef} type="button" onClick={() => setOpen(true)}>Open new page</button>
    {open ? <NewPageDialog
      spaceId="space-1"
      parentOptions={[]}
      returnFocusTo={openerRef.current}
      onClose={() => setOpen(false)}
      onCreated={() => undefined}
      now={new Date(2026, 7, 25, 12)}
    /> : null}
  </MemoryRouter></LanguageProvider>;
};

describe('NewPageDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContentTreeRevision.mockResolvedValue('11');
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('defaults to blank, keeps blank available when the catalog fails, and retries', async () => {
    mocks.listPageTemplates.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);
    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent('模板加载失败');
    expect(screen.getByRole('button', { name: /空白页面/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: /任务清单/ })).toBeInTheDocument();
  });

  it('selects a system version, suggests a title, and posts only template provenance', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    mocks.api.post.mockResolvedValue({ data: { id: 'page-new' } });
    const { onCreated } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^周报(?:\s|$)/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('标题')).toHaveValue('周报 2026年第35周');
    fireEvent.change(screen.getByLabelText('父页面（可选）'), { target: { value: 'parent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(mocks.api.post).toHaveBeenCalledWith('/pages', {
      title: '周报 2026年第35周',
      spaceId: 'space-1',
      parentId: 'parent-1',
      templateId: 'system-weekly',
      templateVersion: 1,
      templateLocale: 'zh-CN',
      expectedTreeRevision: '11',
    }));
    expect(mocks.getContentTreeRevision).toHaveBeenCalledWith('space-1');
    expect(onCreated).toHaveBeenCalledWith('page-new');
    expect(mocks.api.post.mock.calls[0][1]).not.toHaveProperty('content');
    expect(mocks.api.post.mock.calls[0][1]).not.toHaveProperty('format');
  });

  it('creates blank pages without template fields and preserves form state after failure', async () => {
    mocks.listPageTemplates.mockRejectedValue(new Error('offline'));
    mocks.api.post.mockRejectedValue({ response: { data: { code: 'CONFLICT' } } });
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'My page' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('标题')).toHaveValue('My page');
    expect(mocks.api.post).toHaveBeenCalledWith('/pages', {
      title: 'My page', spaceId: 'space-1', expectedTreeRevision: '11',
    });
  });

  it('keeps Space template default titles literal even when they contain system tokens', async () => {
    mocks.listPageTemplates.mockResolvedValue({
      ...catalog,
      space: [{ ...spaceTemplate, defaultTitle: '团队日报 {date}' }],
    });
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /团队周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('标题')).toHaveValue('团队日报 {date}');
  });

  it('moves focus to the title when advancing to page details', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));

    expect(screen.getByLabelText('标题')).toHaveFocus();
  });

  it('filters templates by scope and exposes management only when the capability allows it', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    renderDialog();

    await screen.findByRole('button', { name: /团队周报/ });
    fireEvent.click(screen.getByRole('button', { name: 'Space 模板' }));
    expect(screen.queryByRole('button', { name: /^周报/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /团队周报/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '管理模板' })).toHaveAttribute(
      'href',
      '/spaces/space-1/settings/page-templates',
    );
  });

  it('shows localized selected state and scope labels on template cards as selection moves', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    renderDialog();

    const blank = screen.getByRole('button', { name: /空白页面/ });
    const system = await screen.findByRole('button', { name: /^周报(?:\s|$)/u });
    const space = screen.getByRole('button', { name: /团队周报/ });

    expect(within(blank).getByText('已选择')).toBeVisible();
    expect(within(blank).getByText('空白')).toBeVisible();
    expect(within(system).getByText('系统')).toBeVisible();
    expect(within(space).getByText('Space')).toBeVisible();

    fireEvent.click(space);
    expect(within(space).getByText('已选择')).toBeVisible();
    expect(within(blank).queryByText('已选择')).not.toBeInTheDocument();
  });

  it('shows a localized non-version summary for blank and vN for a selected template', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    expect(screen.getByText('空白入口 · 无模板版本')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(screen.getByRole('button', { name: /^周报(?:\s|$)/u }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('模板版本 v1')).toBeVisible();
  });

  it('truncates a 201-character Unicode page title to the server-valid 200 boundary', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    mocks.api.post.mockResolvedValue({ data: { id: 'page-new' } });
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '😀'.repeat(201) } });

    expect(screen.getByLabelText('标题')).toHaveValue('😀'.repeat(200));
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(mocks.api.post).toHaveBeenCalledWith(
      '/pages', expect.objectContaining({ title: '😀'.repeat(200) }),
    ));
  });

  it('ignores a stale catalog response after the Space changes', async () => {
    let resolveOld!: (value: PageTemplateListResponse) => void;
    let resolveNew!: (value: PageTemplateListResponse) => void;
    mocks.listPageTemplates.mockImplementation((spaceId: string) => new Promise((resolve) => {
      if (spaceId === 'space-old') resolveOld = resolve;
      else resolveNew = resolve;
    }));
    render(<DeferredCatalogHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
    resolveNew({ ...catalog, system: [{ ...systemTasks, id: 'new-template', name: '新模板' }] });
    expect(await screen.findByRole('button', { name: /新模板/ })).toBeInTheDocument();
    resolveOld({ ...catalog, system: [{ ...systemTasks, id: 'old-template', name: '旧模板' }] });

    await waitFor(() => expect(screen.queryByRole('button', { name: /旧模板/ })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /新模板/ })).toBeInTheDocument();
  });

  it('invalidates the completed catalog and form immediately when the Space identity changes', async () => {
    let rejectNew!: (reason: unknown) => void;
    mocks.listPageTemplates.mockImplementation((spaceId: string) => spaceId === 'space-old'
      ? Promise.resolve(catalog)
      : new Promise((_resolve, reject) => { rejectNew = reject; }));
    render(<DeferredCatalogHarness />);

    fireEvent.click(await screen.findByRole('button', { name: /团队周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Old Space title' } });

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));

    expect(screen.getByText('选择模板')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /空白页面/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /团队周报/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理模板' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建' })).not.toBeInTheDocument();
    expect(mocks.api.post).not.toHaveBeenCalled();

    await act(async () => { rejectNew(new Error('offline')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('模板加载失败');
    expect(screen.getByRole('button', { name: /空白页面/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('invalidates the completed catalog and form immediately when the language identity changes', async () => {
    let resolveEnglish!: (value: PageTemplateListResponse) => void;
    mocks.listPageTemplates.mockImplementation((_spaceId: string, options: { locale: string }) =>
      options.locale === 'zh-CN'
        ? Promise.resolve(catalog)
        : new Promise((resolve) => { resolveEnglish = resolve; }));
    render(<LanguageIdentityHarness />);

    fireEvent.click(await screen.findByRole('button', { name: /团队周报/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Old language title' } });

    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(screen.getByText('Choose a template')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Blank page/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /团队周报/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage templates' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    act(() => resolveEnglish({
      ...catalog,
      system: [{ ...systemTasks, id: 'english-template', name: 'English task list' }],
      space: [],
      capabilities: { canManage: false },
    }));
    expect(await screen.findByRole('button', { name: /English task list/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage templates' })).not.toBeInTheDocument();
  });

  it('preserves blank-page form input across a retry generation', async () => {
    mocks.listPageTemplates.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);
    renderDialog();

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Keep this title' } });
    fireEvent.change(screen.getByLabelText('父页面（可选）'), { target: { value: 'parent-1' } });
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByRole('button', { name: /任务清单/ });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    expect(screen.getByLabelText('标题')).toHaveValue('Keep this title');
    expect(screen.getByLabelText('父页面（可选）')).toHaveValue('parent-1');
  });

  it('prevents duplicate create and closing while the request is pending', async () => {
    let resolveCreate!: (value: { data: { id: string } }) => void;
    mocks.listPageTemplates.mockResolvedValue(catalog);
    mocks.api.post.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const { onClose, onCreated } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Pending page' } });
    const form = screen.getByLabelText('标题').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    const close = screen.getByRole('button', { name: '关闭' });
    const cancel = screen.getByRole('button', { name: '取消' });
    const back = screen.getByRole('button', { name: '上一步' });
    expect(close).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(back).toBeDisabled();
    fireEvent.click(close);
    fireEvent.click(cancel);
    fireEvent.click(back);
    fireEvent.click(dialog.parentElement!);

    await waitFor(() => expect(mocks.api.post).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled();
    expect(screen.getByLabelText('标题')).toHaveValue('Pending page');
    resolveCreate({ data: { id: 'page-new' } });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('page-new'));
  });

  it('returns focus to the opener on Escape and keeps the dialog mobile-safe', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    render(<OpenerHarness />);
    const opener = screen.getByRole('button', { name: 'Open new page' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('w-full', 'max-w-2xl', 'overflow-y-auto');
    expect(dialog.querySelector('.grid-cols-1')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps focus inside the dialog after Back so Escape closes and restores the opener', async () => {
    mocks.listPageTemplates.mockResolvedValue(catalog);
    render(<OpenerHarness />);
    const opener = screen.getByRole('button', { name: 'Open new page' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('标题')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));

    const close = screen.getByRole('button', { name: '关闭' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
