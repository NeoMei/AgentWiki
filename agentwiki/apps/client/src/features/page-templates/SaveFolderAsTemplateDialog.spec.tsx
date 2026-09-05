import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { validDefinition } from '../collaboration/collaboration-test-fixtures';
import { SaveFolderAsTemplateDialog } from './SaveFolderAsTemplateDialog';
import type { FolderSourceNode } from './compositeTemplateTypes';

const mocks = vi.hoisted(() => ({
  previewFolderTemplate: vi.fn(), saveFolderTemplate: vi.fn(),
  discoverFolderCollaborationSource: vi.fn(), getLegacyWorkflowUpgradeSource: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock('./compositeTemplateApi', () => mocks);
vi.mock('../collaboration/api', () => ({ collaborationApi: { listTemplates: mocks.listTemplates } }));

const sourceNodes: FolderSourceNode[] = [
  { templateNodeId: 'folder-1', sourceNodeId: 'root', parentSourceNodeId: null, parentTemplateNodeId: null, kind: 'folder' as const, name: 'Workspace' },
  { templateNodeId: 'folder-2', sourceNodeId: 'nested-a', parentSourceNodeId: 'root', parentTemplateNodeId: 'folder-1', kind: 'folder' as const, name: 'Repeated' },
  { templateNodeId: 'page-1', sourceNodeId: 'page-a', parentSourceNodeId: 'nested-a', parentTemplateNodeId: 'folder-2', kind: 'page' as const, title: 'Brief' },
  { templateNodeId: 'folder-3', sourceNodeId: 'nested-b', parentSourceNodeId: 'root', parentTemplateNodeId: 'folder-1', kind: 'folder' as const, name: 'Repeated' },
  { templateNodeId: 'page-2', sourceNodeId: 'page-b', parentSourceNodeId: 'nested-b', parentTemplateNodeId: 'folder-3', kind: 'page' as const, title: 'Brief' },
];

const preview = (nodes = sourceNodes) => ({
  definition: {
    schemaVersion: 1 as const, kind: 'page_group' as const,
    nodes: nodes.map((node, index) => node.kind === 'folder'
      ? { nodeId: node.templateNodeId, parentNodeId: node.parentTemplateNodeId, kind: 'folder' as const, order: index, nameI18n: { en: node.name } }
      : { nodeId: node.templateNodeId, parentNodeId: node.parentTemplateNodeId, kind: 'page' as const, order: index, titleI18n: { en: node.title }, contentI18n: { en: '# server persisted' }, roleSlotKey: null }),
    collaboration: null,
  },
  tree: [], roles: [], sourceNodes: nodes,
  warnings: [
    { code: 'ATTACHMENTS_NOT_COPIED' as const, affectedPageIds: ['page-a'], message: 'server warning' },
    { code: 'SOURCE_CONTENT_REVIEW_REQUIRED' as const, affectedPageIds: ['page-a', 'page-b'], message: 'server warning' },
  ],
  sourceToken: { digest: 'digest-1', treeRevision: '7', pages: [], workflowSource: {} },
});

const renderDialog = () => render(<LanguageProvider><SaveFolderAsTemplateDialog
  spaceId="space-1" folderId="root" folderName="Workspace" onClose={() => undefined} onSaved={() => undefined}
/></LanguageProvider>);

describe('SaveFolderAsTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'en');
    mocks.previewFolderTemplate.mockResolvedValue(preview());
    mocks.saveFolderTemplate.mockResolvedValue({ id: 'saved', currentVersion: 1 });
    mocks.discoverFolderCollaborationSource.mockResolvedValue({ source: null });
    mocks.getLegacyWorkflowUpgradeSource.mockResolvedValue({
      legacyId: 'legacy-1', version: 5, definitionHash: 'a'.repeat(64), definition: validDefinition,
    });
    mocks.listTemplates.mockResolvedValue([{ id: 'legacy-1', spaceId: 'space-1', slug: 'legacy', name: 'Legacy plan', description: '', system: false, version: 5 }]);
  });

  it('prunes nested runtime IDs and structure-only never serializes roles or workflow', async () => {
    renderDialog();
    const nestedA = await screen.findByRole('checkbox', { name: 'Include folder Repeated (nested-a)' });
    fireEvent.click(nestedA);

    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenLastCalledWith('space-1', 'root', expect.objectContaining({
      excludedFolderIds: ['nested-a'], excludedPageIds: [], source: { kind: 'structure_only' },
    }), expect.any(AbortSignal)));
    expect(screen.queryByLabelText(/Responsibility for/)).not.toBeInTheDocument();
  });

  it('requires explicit simple-page duties and attachment acknowledgement before save', async () => {
    renderDialog();
    await screen.findByText('Workspace');
    fireEvent.click(screen.getByRole('radio', { name: 'Independent page duties' }));
    expect(await screen.findByLabelText('Responsibility for Brief (page-a)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Responsibility for Brief (page-a)'), { target: { value: 'writer' } });
    fireEvent.change(screen.getByLabelText('Responsibility for Brief (page-b)'), { target: { value: 'reviewer' } });
    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenLastCalledWith('space-1', 'root', expect.objectContaining({
      roleSlotsByPage: [
        { pageId: 'page-a', roleSlotKey: 'writer' },
        { pageId: 'page-b', roleSlotKey: 'reviewer' },
      ],
    }), expect.any(AbortSignal)));

    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /attachments and resources are not copied/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(mocks.saveFolderTemplate).toHaveBeenCalledWith('space-1', expect.objectContaining({
      acknowledgedWarnings: ['ATTACHMENTS_NOT_COPIED'],
      sourceToken: expect.objectContaining({ digest: 'digest-1' }),
    })));
    expect(JSON.stringify(mocks.saveFolderTemplate.mock.calls[0])).not.toContain('# server persisted');
  });

  it('keeps authoritative full runtime identity inventory across prune refresh and reinclude', async () => {
    mocks.previewFolderTemplate
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(preview(sourceNodes.filter((node) => node.sourceNodeId !== 'nested-a' && node.sourceNodeId !== 'page-a')))
      .mockResolvedValueOnce(preview(sourceNodes));
    renderDialog();
    const nestedA = await screen.findByRole('checkbox', { name: 'Include folder Repeated (nested-a)' });
    fireEvent.click(nestedA);
    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: 'Include folder Repeated (nested-a)' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh source' }));
    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include folder Repeated (nested-a)' }));

    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenCalledTimes(5));
    expect(mocks.previewFolderTemplate.mock.calls[4][2].excludedFolderIds).toEqual([]);
  });

  it('reconciles SOURCE_CHANGED by actual IDs without silently replacing retained input', async () => {
    mocks.saveFolderTemplate.mockRejectedValueOnce({ response: { data: { code: 'SOURCE_CHANGED' } } });
    const changed = preview(sourceNodes.filter((node) => node.sourceNodeId !== 'page-b'));
    changed.sourceToken.digest = 'digest-2';
    mocks.previewFolderTemplate.mockResolvedValueOnce(preview()).mockResolvedValueOnce(changed);
    renderDialog();
    await screen.findByText('Workspace');
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'My retained name' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /attachments and resources are not copied/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('button', { name: 'Refresh changed source' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh changed source' }));

    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Template name')).toHaveValue('My retained name');
    expect(await screen.findByText(/page-b/)).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Include page Brief (page-b)' })).not.toBeInTheDocument();
  });

  it('ignores a previous Space preview after remounting for a different route scope', async () => {
    let resolveOld!: (value: ReturnType<typeof preview>) => void;
    const old = new Promise<ReturnType<typeof preview>>((resolve) => { resolveOld = resolve; });
    mocks.previewFolderTemplate.mockReturnValueOnce(old).mockResolvedValueOnce(preview());
    const view = render(<LanguageProvider><SaveFolderAsTemplateDialog spaceId="space-a" folderId="root-a" folderName="A" onClose={() => undefined} onSaved={() => undefined} /></LanguageProvider>);
    view.rerender(<LanguageProvider><SaveFolderAsTemplateDialog spaceId="space-b" folderId="root-b" folderName="B" onClose={() => undefined} onSaved={() => undefined} /></LanguageProvider>);
    await screen.findByText('Workspace');
    const oldRoot = sourceNodes[0] as Extract<FolderSourceNode, { kind: 'folder' }>;
    await act(async () => resolveOld(preview([{ ...oldRoot, sourceNodeId: 'old-root', name: 'Old Workspace' }])));
    expect(screen.queryByText('Old Workspace')).not.toBeInTheDocument();
  });

  it('resolves an exact composite source from the selected Folder instead of asking for internal IDs', async () => {
    mocks.discoverFolderCollaborationSource.mockResolvedValueOnce({ source: {
      sourceInstantiationId: 'instance-1', compositeTemplateVersionId: 'version-exact',
      templateId: 'template-1', templateVersion: 3, rootFolderId: 'root', nodes: [],
    } });
    renderDialog();
    await waitFor(() => expect(mocks.discoverFolderCollaborationSource).toHaveBeenCalledWith('space-1', 'root'));
    const exactSource = await screen.findByRole('radio', { name: 'Exact composite template version' });
    expect(exactSource).toBeEnabled();
    fireEvent.click(exactSource);
    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenLastCalledWith(
      'space-1', 'root', expect.objectContaining({ source: { kind: 'template', versionId: 'version-exact' } }), expect.any(AbortSignal),
    ));
    expect(screen.queryByLabelText(/version ID/i)).not.toBeInTheDocument();
    expect(screen.getByText(/v3/)).toBeVisible();
  });

  it('disables exact-source reuse with an explanation when the Folder has no exact origin', async () => {
    renderDialog();

    await waitFor(() => expect(mocks.discoverFolderCollaborationSource).toHaveBeenCalledWith('space-1', 'root'));
    expect(screen.getByRole('radio', { name: 'Exact composite template version' })).toBeDisabled();
    expect(screen.getByText(/not the exact root/i)).toBeVisible();
  });

  it('selects a legacy template and maps its tasks to retained Pages without raw ID textareas', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('radio', { name: 'Legacy workflow with explicit mapping' }));
    const chooser = await screen.findByLabelText('Legacy workflow template');
    fireEvent.change(chooser, { target: { value: 'legacy-1' } });
    fireEvent.change(await screen.findByLabelText('Page for Draft'), { target: { value: 'page-a' } });
    fireEvent.change(screen.getByLabelText('Page for Agent review'), { target: { value: 'page-b' } });

    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenLastCalledWith(
      'space-1', 'root', expect.objectContaining({ source: {
        kind: 'legacy_workflow', templateId: 'legacy-1', version: 5,
        taskTargets: [{ taskNodeId: 'draft', pageId: 'page-a' }, { taskNodeId: 'review', pageId: 'page-b' }],
      } }), expect.any(AbortSignal),
    ));
    expect(screen.queryByPlaceholderText('task-id=page-id')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Legacy workflow version/i)).not.toBeInTheDocument();
  });

  it('invalidates legacy mappings when a mapped Page is excluded or disappears and requires remapping after reinclude', async () => {
    let structureInventoryRead = 0;
    const withoutPageB = sourceNodes.filter((node) => node.sourceNodeId !== 'page-b');
    mocks.previewFolderTemplate.mockImplementation((_spaceId, _folderId, selection) => {
      if (selection.source.kind === 'structure_only'
        && selection.excludedFolderIds.length === 0
        && selection.excludedPageIds.length === 0) {
        structureInventoryRead += 1;
        return Promise.resolve(preview(structureInventoryRead === 2 ? withoutPageB : sourceNodes));
      }
      if (selection.source.kind === 'legacy_workflow'
        && selection.source.taskTargets.some((target: { pageId: string }) => selection.excludedPageIds.includes(target.pageId))) {
        return Promise.reject({ response: { data: { code: 'TEMPLATE_PAGE_TARGET_MISSING' } } });
      }
      return Promise.resolve(preview());
    });

    renderDialog();
    fireEvent.click(await screen.findByRole('radio', { name: 'Legacy workflow with explicit mapping' }));
    fireEvent.change(await screen.findByLabelText('Legacy workflow template'), { target: { value: 'legacy-1' } });
    fireEvent.change(await screen.findByLabelText('Page for Draft'), { target: { value: 'page-a' } });
    fireEvent.change(screen.getByLabelText('Page for Agent review'), { target: { value: 'page-b' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Include page Brief (page-b)' }));

    expect(screen.getByLabelText('Page for Agent review')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include page Brief (page-b)' }));
    expect(screen.getByLabelText('Page for Agent review')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Page for Agent review'), { target: { value: 'page-b' } });
    await waitFor(() => expect(screen.getByLabelText('Page for Agent review')).toHaveValue('page-b'));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh source' }));
    await waitFor(() => expect(screen.getByText(/These source IDs disappeared.*page-b/)).toBeVisible());
    expect(screen.getByLabelText('Page for Agent review')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
    expect(mocks.previewFolderTemplate).toHaveBeenLastCalledWith(
      'space-1', 'root', expect.objectContaining({ source: { kind: 'structure_only' } }), expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh source' }));
    await waitFor(() => expect(screen.getByLabelText('Page for Agent review')).toContainHTML('page-b'));
    expect(screen.getByLabelText('Page for Agent review')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Page for Agent review'), { target: { value: 'page-b' } });

    await waitFor(() => expect(mocks.previewFolderTemplate).toHaveBeenLastCalledWith(
      'space-1', 'root', expect.objectContaining({ source: expect.objectContaining({
        kind: 'legacy_workflow',
        taskTargets: [{ taskNodeId: 'draft', pageId: 'page-a' }, { taskNodeId: 'review', pageId: 'page-b' }],
      }) }), expect.any(AbortSignal),
    ));
  });
});
