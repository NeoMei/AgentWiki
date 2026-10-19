import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import { TemplateContentPreview, type TemplatePreviewSelection } from './TemplateContentPreview';
import type { PageTemplateDetail, PageTemplateSummary } from './pageTemplateTypes';
import type { CompositeTemplatePreview, CompositeTemplateSummary } from './compositeTemplateTypes';
const requests = vi.hoisted(() => ({ legacy: vi.fn(), composite: vi.fn() }));
vi.mock('./pageTemplateApi', () => ({ getPageTemplate: requests.legacy }));
vi.mock('./compositeTemplateApi', () => ({ previewCompositeTemplate: requests.composite }));
const legacy: PageTemplateSummary = {
  id: 'daily', stableKey: 'daily', scope: 'system', sourceLocale: null,
  category: 'reporting', name: '日报', description: '日报说明', defaultTitle: '日报',
  currentVersion: 3, archivedAt: null, updatedAt: '2026-10-19T00:00:00Z',
};
const composite: CompositeTemplateSummary = {
  ...legacy, kind: 'page_group', storageKind: 'definition', supportsCollaboration: true,
  effectiveSupportsCollaboration: true, pageCount: 2, folderCount: 1, roleCount: 1,
};
const legacyDetail = (content = '## 今日进展\n\n交付模板的实际正文\n\n- [ ] 核对成果'): PageTemplateDetail => ({
  ...legacy, content, contentLocale: 'zh-CN', sourcePageId: null,
});
const groupPreview = (): CompositeTemplatePreview => ({
  templateId: 'daily', templateVersion: 3, locale: 'zh-CN', definitionHash: 'hash', treeRevision: '21',
  nodes: [
    { kind: 'folder', nodeId: 'root', parentNodeId: null, order: 0, name: '项目' },
    { kind: 'page', nodeId: 'overview', parentNodeId: 'root', order: 0, title: '项目总览', content: '## 项目目标\n\n第一篇正文' },
    { kind: 'page', nodeId: 'risks', parentNodeId: 'root', order: 1, title: '风险记录', content: '## 风险登记\n\n第二篇正文' },
  ],
  pageCount: 2, folderCount: 1, roleCount: 0, roles: [], inputs: [], inputValues: {},
  tasks: [], assignments: [], participants: [], issues: [],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
function LanguageSwitch() {
  const { toggleLanguage } = useLanguage();
  return <button onClick={toggleLanguage}>Switch language</button>;
}
const view = (selection: TemplatePreviewSelection, spaceId = 'space-1') => (
  <LanguageProvider><MemoryRouter><LanguageSwitch />
    <TemplateContentPreview spaceId={spaceId} template={selection} />
  </MemoryRouter></LanguageProvider>
);
describe('TemplateContentPreview', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    requests.legacy.mockResolvedValue(legacyDetail());
    requests.composite.mockResolvedValue(groupPreview());
  });
  it('shows the selected legacy template body as a read-only document, not just metadata', async () => {
    render(view({ source: 'legacy', value: legacy }));
    expect(await screen.findByRole('heading', { name: /今日进展/ })).toBeVisible();
    expect(screen.getByText('交付模板的实际正文')).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(requests.legacy).toHaveBeenCalledWith('space-1', 'daily', 'zh-CN');
  });
  it('previews the exact composite version without enabling collaboration and can switch page bodies', async () => {
    render(view({ source: 'composite', value: composite }));
    expect(await screen.findByText('第一篇正文')).toBeVisible();
    expect(requests.composite).toHaveBeenCalledWith('space-1', 'daily', {
      templateVersion: 3, locale: 'zh-CN', rootName: '日报', variables: {}, collaborationEnabled: false,
    }, expect.any(AbortSignal));
    fireEvent.change(screen.getByRole('combobox', { name: '预览页面' }), { target: { value: 'risks' } });
    expect(screen.getByRole('heading', { name: /风险登记/ })).toBeVisible();
    expect(screen.queryByText('第一篇正文')).not.toBeInTheDocument();
  });
  it('refuses a changed legacy version instead of showing new content for an old selection', async () => {
    requests.legacy.mockResolvedValue({ ...legacyDetail('不能作为旧版预览的新正文'), currentVersion: 4 });
    render(view({ source: 'legacy', value: legacy }));
    expect(await screen.findByRole('alert')).toHaveTextContent('模板版本已更新，请刷新模板列表后重新选择');
    expect(screen.queryByText('不能作为旧版预览的新正文')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放大预览' })).toBeDisabled();
  });

  it('renders a composite single-page template body', async () => {
    requests.composite.mockResolvedValue({ ...groupPreview(), nodes: groupPreview().nodes.slice(1, 2), pageCount: 1, folderCount: 0 });
    render(view({ source: 'composite', value: { ...composite, kind: 'single_page', pageCount: 1, folderCount: 0 } }));
    expect(await screen.findByText('第一篇正文')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
  it('opens a larger read-only preview and closes it with Escape', async () => {
    render(view({ source: 'legacy', value: legacy }));
    await screen.findByText('交付模板的实际正文');
    fireEvent.click(screen.getByRole('button', { name: '放大预览' }));
    const dialog = screen.getByRole('dialog', { name: /日报/ });
    expect(within(dialog).getByText('交付模板的实际正文')).toBeVisible();
    expect(within(dialog).getByRole('checkbox')).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('交付模板的实际正文')).toBeVisible();
  });
  it('shows loading and ignores a late response after selecting another template', async () => {
    const old = deferred<PageTemplateDetail>();
    requests.legacy.mockReturnValueOnce(old.promise);
    const mounted = render(view({ source: 'legacy', value: legacy }));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载模板内容');
    mounted.rerender(view({ source: 'legacy', value: { ...legacy, id: 'new' } }));
    await screen.findByText('交付模板的实际正文');
    await act(async () => old.resolve(legacyDetail('已经离开的旧模板')));
    expect(screen.queryByText('已经离开的旧模板')).not.toBeInTheDocument();
  });
  it('removes old content immediately when changing source with the same template id', async () => {
    const next = deferred<CompositeTemplatePreview>();
    requests.composite.mockReturnValueOnce(next.promise);
    const mounted = render(view({ source: 'legacy', value: legacy }));
    await screen.findByText('交付模板的实际正文');
    mounted.rerender(view({ source: 'composite', value: composite }));
    expect(screen.queryByText('交付模板的实际正文')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在加载模板内容');
    await act(async () => next.resolve(groupPreview()));
    expect(screen.getByText('第一篇正文')).toBeVisible();
  });
  it('retries an unsuccessful preview and replaces the error with content', async () => {
    requests.legacy.mockRejectedValueOnce(new Error('offline'));
    render(view({ source: 'legacy', value: legacy }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载模板内容');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('交付模板的实际正文')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('shows an explicit empty-content state', async () => {
    requests.legacy.mockResolvedValue(legacyDetail('  \n '));
    render(view({ source: 'legacy', value: legacy }));
    expect(await screen.findByText('此页面尚无正文')).toBeVisible();
  });
  it('shows a distinct empty-group state when a template contains only folders', async () => {
    requests.composite.mockResolvedValue({ ...groupPreview(), nodes: [groupPreview().nodes[0]], pageCount: 0 });
    render(view({ source: 'composite', value: composite }));
    expect(await screen.findByText('此模板不包含页面正文')).toBeVisible();
    expect(screen.getByRole('button', { name: '放大预览' })).toBeDisabled();
  });
  it('reloads for a new language and ignores a previous language response', async () => {
    const old = deferred<PageTemplateDetail>();
    requests.legacy.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...legacyDetail('English template body'), contentLocale: 'en' });
    render(view({ source: 'legacy', value: legacy }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(await screen.findByText('English template body')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand preview' })).toBeVisible();
    expect(requests.legacy).toHaveBeenLastCalledWith('space-1', 'daily', 'en');
    await act(async () => old.resolve(legacyDetail('过期的中文正文')));
    expect(screen.queryByText('过期的中文正文')).not.toBeInTheDocument();
  });
  it('cancels a composite request on unmount and a late rejection cannot affect a subsequent mount', async () => {
    const old = deferred<CompositeTemplatePreview>();
    requests.composite.mockReturnValueOnce(old.promise);
    const mounted = render(view({ source: 'composite', value: composite }));
    const signal = requests.composite.mock.calls[0][3] as AbortSignal;
    mounted.unmount();
    expect(signal.aborted).toBe(true);
    render(view({ source: 'composite', value: composite }));
    await screen.findByText('第一篇正文');
    await act(async () => old.reject(new Error('late cancellation')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('第一篇正文')).toBeVisible();
  });
});
