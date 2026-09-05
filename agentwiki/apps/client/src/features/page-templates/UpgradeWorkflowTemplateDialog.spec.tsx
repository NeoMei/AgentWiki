import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { validDefinition } from '../collaboration/collaboration-test-fixtures';
import type { TemplateSummary } from '../collaboration/types';
import { UpgradeWorkflowTemplateDialog } from './UpgradeWorkflowTemplateDialog';

const mocks = vi.hoisted(() => ({
  listTreeChildren: vi.fn(), getLegacyWorkflowUpgradeSource: vi.fn(),
  previewFolderTemplate: vi.fn(), previewLegacyWorkflowUpgrade: vi.fn(), upgradeLegacyWorkflow: vi.fn(),
}));

vi.mock('../content-tree/contentTreeApi', () => ({ listTreeChildren: mocks.listTreeChildren }));
vi.mock('./compositeTemplateApi', () => ({
  getLegacyWorkflowUpgradeSource: mocks.getLegacyWorkflowUpgradeSource,
  previewFolderTemplate: mocks.previewFolderTemplate,
  previewLegacyWorkflowUpgrade: mocks.previewLegacyWorkflowUpgrade,
  upgradeLegacyWorkflow: mocks.upgradeLegacyWorkflow,
}));

const legacy: TemplateSummary = {
  id: 'legacy-1', spaceId: 'space-1', slug: 'legacy-1', name: 'Legacy plan', description: 'Old flow',
  system: false, version: 4,
};

const folderPreview = {
  definition: {
    schemaVersion: 1 as const, kind: 'page_group' as const,
    nodes: [
      { nodeId: 'folder-1', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Project' } },
      { nodeId: 'page-1', parentNodeId: 'folder-1', kind: 'page' as const, order: 0, titleI18n: { en: 'Draft' }, contentI18n: { en: '# saved' }, roleSlotKey: null },
      { nodeId: 'page-2', parentNodeId: 'folder-1', kind: 'page' as const, order: 1, titleI18n: { en: 'Review' }, contentI18n: { en: '# saved review' }, roleSlotKey: null },
    ],
    collaboration: null,
  },
  tree: [], roles: [], sourceNodes: [], warnings: [],
  sourceToken: { digest: 'd', treeRevision: '7', pages: [], workflowSource: {} },
};

const renderDialog = (onUpgraded = vi.fn()) => render(<LanguageProvider><UpgradeWorkflowTemplateDialog
  spaceId="space-1" legacyTemplate={legacy} onClose={() => undefined} onUpgraded={onUpgraded}
/></LanguageProvider>);

describe('UpgradeWorkflowTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'en');
    mocks.listTreeChildren.mockResolvedValue({
      spaceId: 'space-1', treeRevision: '7', parentFolderId: null, nextCursor: null,
      data: [{ kind: 'folder', id: 'folder-real', name: 'Project', path: '/Project', sortOrder: 0, createdAt: '', updatedAt: '', hasChildren: true }],
    });
    mocks.getLegacyWorkflowUpgradeSource.mockResolvedValue({ legacyId: 'legacy-1', version: 4, definitionHash: 'a'.repeat(64), definition: validDefinition });
    mocks.previewFolderTemplate.mockResolvedValue(folderPreview);
    mocks.previewLegacyWorkflowUpgrade.mockResolvedValue({ definition: { ...folderPreview.definition, collaboration: { workflow: validDefinition, taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page-1' }, { taskNodeId: 'review', pageNodeId: 'page-2' }] } }, definitionHash: 'b'.repeat(64), upgradeRequestHash: 'c'.repeat(64), issues: [] });
    mocks.upgradeLegacyWorkflow.mockResolvedValue({ templateId: 'composite-1', currentVersion: 3, resultVersion: 1 });
  });

  it('loads canonical workflow and a real Folder choice, then submits only nodes and explicit task targets', async () => {
    renderDialog();
    const folder = await screen.findByLabelText('Source folder');
    fireEvent.change(folder, { target: { value: 'folder-real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load folder snapshot' }));

    expect(await screen.findByText(/read-only during upgrade/i)).toBeVisible();
    expect(screen.queryByLabelText('Step name')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target page for Draft'), { target: { value: 'page-1' } });
    fireEvent.change(screen.getByLabelText('Target page for Agent review'), { target: { value: 'page-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate upgrade' }));

    const expected = expect.objectContaining({
      expectedLegacyVersion: 4,
      expectedLegacyDefinitionHash: 'a'.repeat(64),
      nodes: folderPreview.definition.nodes,
      taskTargets: [
        { taskNodeId: 'draft', pageNodeId: 'page-1' },
        { taskNodeId: 'review', pageNodeId: 'page-2' },
      ],
    });
    await waitFor(() => expect(mocks.previewLegacyWorkflowUpgrade).toHaveBeenCalledWith('space-1', 'legacy-1', expected));
    expect(JSON.stringify(mocks.previewLegacyWorkflowUpgrade.mock.calls[0][2])).not.toContain('workflow');

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade template' }));
    await waitFor(() => expect(mocks.upgradeLegacyWorkflow).toHaveBeenCalledWith('space-1', 'legacy-1', expected));
  });

  it('shows the immutable resultVersion instead of the current head', async () => {
    const onUpgraded = vi.fn();
    renderDialog(onUpgraded);
    fireEvent.change(await screen.findByLabelText('Source folder'), { target: { value: 'folder-real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load folder snapshot' }));
    fireEvent.change(await screen.findByLabelText('Target page for Draft'), { target: { value: 'page-1' } });
    fireEvent.change(screen.getByLabelText('Target page for Agent review'), { target: { value: 'page-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate upgrade' }));
    await screen.findByText('Upgrade is valid');
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade template' }));

    expect(await screen.findByText('Created immutable version v1')).toBeVisible();
    expect(screen.queryByText(/v3/)).not.toBeInTheDocument();
    expect(onUpgraded).toHaveBeenCalledWith(expect.objectContaining({ resultVersion: 1 }));
  });

  it('keeps human-gate validation issues visible and blocks commit', async () => {
    mocks.previewLegacyWorkflowUpgrade.mockResolvedValueOnce({
      definition: { ...folderPreview.definition, collaboration: { workflow: validDefinition, taskTargets: [] } },
      definitionHash: 'b'.repeat(64), upgradeRequestHash: 'c'.repeat(64),
      issues: [{ code: 'LEGACY_REQUIRED_HUMAN_GATES_MULTIPLE' }],
    });
    renderDialog();
    fireEvent.change(await screen.findByLabelText('Source folder'), { target: { value: 'folder-real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load folder snapshot' }));
    fireEvent.change(await screen.findByLabelText('Target page for Draft'), { target: { value: 'page-1' } });
    fireEvent.change(screen.getByLabelText('Target page for Agent review'), { target: { value: 'page-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate upgrade' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('LEGACY_REQUIRED_HUMAN_GATES_MULTIPLE');
    expect(screen.getByRole('button', { name: 'Upgrade template' })).toBeDisabled();
  });

  it('reloads the canonical workflow, preserves only matching task mappings, and surfaces task changes', async () => {
    const publishTask = {
      ...validDefinition.nodes[1], id: 'publish', name: 'Publish',
      upstreamArtifacts: [{ key: 'draft', required: true }],
      output: { key: 'publish', kind: 'markdown' as const },
      todos: [{ id: 'publish', name: 'Publish', required: true, evidenceKinds: [] }],
    };
    const nextDefinition = {
      ...validDefinition,
      nodes: [validDefinition.nodes[0], publishTask],
      dependencies: [{ from: 'draft', to: 'publish', mode: 'all' as const }],
      terminalNodeIds: ['publish'],
    };
    mocks.getLegacyWorkflowUpgradeSource
      .mockResolvedValueOnce({ legacyId: 'legacy-1', version: 4, definitionHash: 'a'.repeat(64), definition: validDefinition })
      .mockResolvedValueOnce({ legacyId: 'legacy-1', version: 5, definitionHash: 'b'.repeat(64), definition: nextDefinition });
    mocks.previewLegacyWorkflowUpgrade.mockRejectedValueOnce({ response: { data: { code: 'COLLABORATION_TEMPLATE_VERSION_CONFLICT' } } });

    renderDialog();
    fireEvent.change(await screen.findByLabelText('Source folder'), { target: { value: 'folder-real' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load folder snapshot' }));
    fireEvent.change(await screen.findByLabelText('Target page for Draft'), { target: { value: 'page-1' } });
    fireEvent.change(screen.getByLabelText('Target page for Agent review'), { target: { value: 'page-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate upgrade' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reload canonical source' }));

    expect(await screen.findByText('Canonical legacy source v5')).toBeVisible();
    expect(screen.getByText(/New canonical tasks.*Publish.*publish/i)).toBeVisible();
    expect(screen.getByText(/Removed canonical tasks.*Agent review.*review/i)).toBeVisible();
    expect(screen.queryByLabelText('Target page for Agent review')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Target page for Draft')).toHaveValue('page-1');
    expect(screen.getByLabelText('Target page for Publish')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Validate upgrade' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Target page for Publish'), { target: { value: 'page-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate upgrade' }));
    await waitFor(() => expect(mocks.previewLegacyWorkflowUpgrade).toHaveBeenLastCalledWith('space-1', 'legacy-1', expect.objectContaining({
      expectedLegacyVersion: 5,
      expectedLegacyDefinitionHash: 'b'.repeat(64),
      taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page-1' }, { taskNodeId: 'publish', pageNodeId: 'page-2' }],
    })));
  });
});
