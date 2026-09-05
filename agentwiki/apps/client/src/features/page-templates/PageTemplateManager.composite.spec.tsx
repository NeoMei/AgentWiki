import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { validDefinition } from '../collaboration/collaboration-test-fixtures';
import { PageTemplateManager } from './PageTemplateManager';

const mocks = vi.hoisted(() => ({
  listCompositeTemplates: vi.fn(), getCompositeTemplateManagement: vi.fn(),
  updateCompositeTemplateMetadata: vi.fn(), createCompositeTemplateVersion: vi.fn(),
  archiveCompositeTemplate: vi.fn(), restoreCompositeTemplate: vi.fn(),
  listPageTemplates: vi.fn(), getPageTemplate: vi.fn(), listPageTemplateSourcePages: vi.fn(),
  updatePageTemplate: vi.fn(), createPageTemplateVersion: vi.fn(), archivePageTemplate: vi.fn(), restorePageTemplate: vi.fn(),
}));
vi.mock('./compositeTemplateApi', () => mocks);
vi.mock('./pageTemplateApi', () => mocks);
vi.mock('../../components/SpaceNav', () => ({ SpaceNav: () => null }));

const summary = {
  id: 'group-1', scope: 'space' as const, stableKey: 'group', category: 'planning' as const,
  kind: 'page_group' as const, supportsCollaboration: true, effectiveSupportsCollaboration: true,
  pageCount: 2, folderCount: 1, roleCount: 2, name: 'Project group', description: 'Nested work',
  defaultTitle: 'Project', sourceLocale: 'en' as const, currentVersion: 2, archivedAt: null,
  updatedAt: '2026-09-05T00:00:00.000Z',
};
const definition = {
  schemaVersion: 1 as const, kind: 'page_group' as const,
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Project' } },
    { nodeId: 'page-a', parentNodeId: 'root', kind: 'page' as const, order: 0, titleI18n: { en: 'Draft' }, contentI18n: { en: '# saved' }, roleSlotKey: 'writer' },
    { nodeId: 'page-b', parentNodeId: 'root', kind: 'page' as const, order: 1, titleI18n: { en: 'Review' }, contentI18n: { en: '# saved review' }, roleSlotKey: 'reviewer' },
  ],
  collaboration: { workflow: validDefinition, taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page-a' }, { taskNodeId: 'review', pageNodeId: 'page-b' }] },
};

const definitionWithTitle = (title: string) => ({
  ...definition,
  nodes: definition.nodes.map((node) => node.kind === 'page' && node.nodeId === 'page-a'
    ? { ...node, titleI18n: { en: title } }
    : node),
});

const managementDetail = (template = summary, version = template.currentVersion, nextDefinition = definition) => ({
  ...template, templateId: template.id, version, locale: 'en' as const,
  definitionHash: 'a'.repeat(64), definition: nextDefinition,
});

const renderManager = () => {
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/settings/page-templates']}><Routes><Route path="/spaces/:id/settings/page-templates" element={<PageTemplateManager />} /></Routes></MemoryRouter></LanguageProvider>);
};

describe('PageTemplateManager composite catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCompositeTemplates.mockResolvedValue({ data: [summary], total: 1, skip: 0, take: 50, capabilities: { canManage: true, canCreate: true } });
    mocks.listPageTemplateSourcePages.mockResolvedValue({ data: [], total: 0, skip: 0, take: 100 });
    mocks.getCompositeTemplateManagement.mockResolvedValue({ ...summary, templateId: summary.id, version: 2, locale: 'en', definitionHash: 'a'.repeat(64), definition });
    mocks.createCompositeTemplateVersion.mockResolvedValue({ ...summary, templateId: summary.id, currentVersion: 3, version: 3, locale: 'en', definitionHash: 'b'.repeat(64), definition });
  });

  it('uses independent kind and scope filters against the bounded unified catalog', async () => {
    renderManager();
    await screen.findByText('Project group');
    fireEvent.change(screen.getByLabelText('Template kind'), { target: { value: 'page_group' } });
    fireEvent.change(screen.getByLabelText('Template scope'), { target: { value: 'space' } });

    await waitFor(() => expect(mocks.listCompositeTemplates).toHaveBeenLastCalledWith('space-1', expect.objectContaining({
      kind: 'page_group', scope: 'space', skip: 0, take: 50,
    })));
  });

  it('uses the legacy manager and visible fallback copy when composite rollout is off', async () => {
    mocks.listCompositeTemplates.mockResolvedValue({
      data: [summary], total: 1, skip: 0, take: 50,
      capabilities: { canManage: true, canCreate: false },
    });
    mocks.listPageTemplates.mockResolvedValue({
      system: [],
      space: [{
        id: 'legacy-1', scope: 'space', stableKey: 'legacy', category: 'other',
        name: 'Legacy note', description: '', defaultTitle: 'Note', sourceLocale: 'en',
        currentVersion: 1, archivedAt: null, updatedAt: '2026-09-05T00:00:00.000Z',
      }],
      totalSpace: 1, skip: 0, take: 50, capabilities: { canManage: true },
    });

    renderManager();

    expect(await screen.findByText('Composite page groups are not enabled for this Space. Legacy single-page templates remain available.')).toBeVisible();
    expect(screen.getByText('Legacy note')).toBeVisible();
    expect(screen.queryByText('Project group')).not.toBeInTheDocument();
  });

  it('refreshes through the unified catalog when a paginated page makes no progress', async () => {
    mocks.listCompositeTemplates
      .mockResolvedValueOnce({ data: [summary], total: 2, skip: 0, take: 1, capabilities: { canManage: true, canCreate: true } })
      .mockResolvedValueOnce({ data: [summary], total: 2, skip: 1, take: 1, capabilities: { canManage: true, canCreate: true } })
      .mockResolvedValueOnce({ data: [summary], total: 1, skip: 0, take: 50, capabilities: { canManage: true, canCreate: true } });
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(mocks.listCompositeTemplates).toHaveBeenCalledTimes(3));
    expect(mocks.listCompositeTemplates).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ skip: 0 }));
    expect(mocks.listPageTemplates).not.toHaveBeenCalled();
  });

  it('creates a composite version from the preserved nested definition instead of sourcePageId', async () => {
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit structure Project group' }));
    fireEvent.click(await screen.findByRole('button', { name: /Draft page-a/ }));
    fireEvent.change(screen.getByLabelText('Page title page-a'), { target: { value: 'Revised draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create new version' }));

    await waitFor(() => expect(mocks.createCompositeTemplateVersion).toHaveBeenCalledWith('space-1', 'group-1', {
      expectedCurrentVersion: 2,
      definition: expect.objectContaining({
        kind: 'page_group',
        nodes: expect.arrayContaining([expect.objectContaining({ nodeId: 'page-a', parentNodeId: 'root', titleI18n: { en: 'Revised draft' } })]),
      }),
    }));
    expect(JSON.stringify(mocks.createCompositeTemplateVersion.mock.calls[0][2])).not.toContain('sourcePageId');
  });

  it('permits archived composite inspection but keeps system templates read-only', async () => {
    const archived = { ...summary, id: 'archived-1', name: 'Archived group', archivedAt: '2026-09-05T01:00:00.000Z' };
    const system = { ...summary, id: 'system-1', scope: 'system' as const, name: 'System group', sourceLocale: null };
    mocks.listCompositeTemplates.mockResolvedValue({ data: [archived, system], total: 2, skip: 0, take: 50, capabilities: { canManage: true, canCreate: true } });
    mocks.getCompositeTemplateManagement.mockResolvedValue({ ...archived, templateId: archived.id, version: 2, locale: 'en', definitionHash: 'a'.repeat(64), definition });
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Archived group' }));
    expect(await screen.findByText('Nested template definition')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create new version' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('button', { name: /System group/ })).not.toBeInTheDocument();
  });

  it('loads the actual current immutable definition after an explicit composite CAS reload', async () => {
    const headDefinition = definitionWithTitle('Concurrent head');
    mocks.getCompositeTemplateManagement
      .mockResolvedValueOnce(managementDetail())
      .mockResolvedValueOnce({ ...managementDetail(summary, 2), currentVersion: 3 })
      .mockResolvedValueOnce({ ...managementDetail({ ...summary, currentVersion: 3 }, 3, headDefinition), definitionHash: 'b'.repeat(64) });
    mocks.createCompositeTemplateVersion.mockRejectedValueOnce({ response: { data: { code: 'PAGE_TEMPLATE_VERSION_CONFLICT' } } });
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit structure Project group' }));
    fireEvent.click(await screen.findByRole('button', { name: /Draft page-a/ }));
    fireEvent.change(screen.getByLabelText('Page title page-a'), { target: { value: 'Local draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create new version' }));

    await waitFor(() => expect(mocks.createCompositeTemplateVersion).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed/i);
    expect(await screen.findByLabelText('Page title page-a')).toHaveValue('Local draft');
    fireEvent.click(await screen.findByRole('button', { name: 'Reload template' }));

    await waitFor(() => expect(mocks.getCompositeTemplateManagement).toHaveBeenCalledTimes(3));
    expect(mocks.getCompositeTemplateManagement.mock.calls[1].slice(0, 3)).toEqual(['space-1', 'group-1', 2]);
    expect(mocks.getCompositeTemplateManagement.mock.calls[2].slice(0, 3)).toEqual(['space-1', 'group-1', 3]);
    fireEvent.click(await screen.findByRole('button', { name: /Concurrent head page-a/ }));
    expect(screen.getByLabelText('Page title page-a')).toHaveValue('Concurrent head');
  });

  it('ignores stale composite detail success and failure after close and same-Space template switch', async () => {
    const other = { ...summary, id: 'group-2', stableKey: 'group-2', name: 'Other group' };
    mocks.listCompositeTemplates.mockResolvedValue({ data: [summary, other], total: 2, skip: 0, take: 50, capabilities: { canManage: true, canCreate: true } });
    let resolveFirst!: (value: ReturnType<typeof managementDetail>) => void;
    let resolveSecond!: (value: ReturnType<typeof managementDetail>) => void;
    const first = new Promise<ReturnType<typeof managementDetail>>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<ReturnType<typeof managementDetail>>((resolve) => { resolveSecond = resolve; });
    mocks.getCompositeTemplateManagement.mockImplementation((_spaceId, templateId) => templateId === 'group-1' ? first : second);
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit structure Project group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit structure Other group' }));
    await act(async () => resolveSecond(managementDetail(other, 2, definitionWithTitle('Other head'))));
    expect(await screen.findByRole('button', { name: /Other head page-a/ })).toBeVisible();

    await act(async () => resolveFirst(managementDetail(summary, 2, definitionWithTitle('Stale head'))));
    expect(screen.queryByRole('button', { name: /Stale head page-a/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Other head page-a/ })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    let rejectClosed!: (reason: unknown) => void;
    mocks.getCompositeTemplateManagement.mockReturnValueOnce(new Promise((_, reject) => { rejectClosed = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit structure Project group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => rejectClosed(new Error('stale detail failure')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the local draft conflicted when the composite head moves during bounded reload', async () => {
    mocks.getCompositeTemplateManagement
      .mockResolvedValueOnce(managementDetail())
      .mockResolvedValueOnce({ ...managementDetail(summary, 2), currentVersion: 3 })
      .mockResolvedValueOnce({ ...managementDetail({ ...summary, currentVersion: 4 }, 3, definitionWithTitle('Intermediate head')) });
    mocks.createCompositeTemplateVersion.mockRejectedValueOnce({ response: { data: { code: 'PAGE_TEMPLATE_VERSION_CONFLICT' } } });
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit structure Project group' }));
    fireEvent.click(await screen.findByRole('button', { name: /Draft page-a/ }));
    fireEvent.change(screen.getByLabelText('Page title page-a'), { target: { value: 'Local draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create new version' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reload template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed again while reloading/i);
    expect(screen.getByLabelText('Page title page-a')).toHaveValue('Local draft');
    expect(screen.getByRole('button', { name: 'Reload template' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create new version' })).toBeDisabled();
  });
});
