import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { TemplateEditor } from './TemplateEditor';
import type { TemplateDetail } from './types';
import { validDefinition } from './collaboration-test-fixtures';
import { issueLabel } from './components/ValidationIssueList';

vi.mock('./api', () => ({ collaborationApi: {
  getTemplate: vi.fn(), listMembers: vi.fn(), validateTemplate: vi.fn(), updateTemplate: vi.fn(), createTemplate: vi.fn(),
} }));

const template: TemplateDetail = {
  id: 'template-1', spaceId: 'space-1', slug: 'custom', name: 'Custom workflow', description: 'Description',
  system: false, version: 1, definition: validDefinition,
};

const reviewedDefinition = (reviewerUserIds: string[] = []): TemplateDetail['definition'] => ({
  ...validDefinition,
  nodes: [...validDefinition.nodes, {
    kind: 'human_review', id: 'human-review', name: 'Human gate', artifactTaskId: 'review',
    minimumRole: 'editor', reviewerUserIds, approvalCriteria: ['Complete'], revisionTaskId: 'review', allowTerminate: true,
  }],
  dependencies: [...validDefinition.dependencies, { from: 'review', to: 'human-review', mode: 'all' }],
  terminalNodeIds: ['human-review'],
});

function renderEditor() {
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-1']}>
    <Routes><Route path="/spaces/:id/collaboration/templates/:templateId" element={<TemplateEditor mode="edit" />} /></Routes>
  </MemoryRouter></LanguageProvider>);
}

function renderCreateEditor() {
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/new']}>
    <Routes><Route path="/spaces/:id/collaboration/templates/new" element={<TemplateEditor mode="create" />} /></Routes>
  </MemoryRouter></LanguageProvider>);
}

function NavigationEditor() {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate('/spaces/space-1/collaboration/templates/template-new')}>Open new template</button><TemplateEditor mode="edit" /></>;
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([]);
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue(template);
    vi.mocked(collaborationApi.validateTemplate).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(collaborationApi.updateTemplate).mockResolvedValue({ ...template, version: 2, name: 'Release workflow' });
  });

  it('shows a retryable error instead of a permanent spinner when loading fails', async () => {
    vi.mocked(collaborationApi.getTemplate)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(template);

    renderEditor();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the template.');
    expect(screen.queryByTestId('template-editor-loading')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByDisplayValue('Custom workflow')).toBeVisible();
  });

  it('ignores a stale template response after navigating to another template', async () => {
    let resolveOld!: (value: TemplateDetail) => void;
    const oldRequest = new Promise<TemplateDetail>((resolve) => { resolveOld = resolve; });
    vi.mocked(collaborationApi.getTemplate)
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce({ ...template, id: 'template-new', name: 'New workflow' });
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-old']}>
      <Routes><Route path="/spaces/:id/collaboration/templates/:templateId" element={<NavigationEditor />} /></Routes>
    </MemoryRouter></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open new template' }));
    expect(await screen.findByDisplayValue('New workflow')).toBeVisible();
    await act(async () => resolveOld({ ...template, id: 'template-old', name: 'Old workflow' }));
    expect(screen.queryByDisplayValue('Old workflow')).not.toBeInTheDocument();
  });

  it('renders a usable blank editor when the static route selects create mode', async () => {
    renderCreateEditor();

    expect(await screen.findByRole('heading', { name: 'Create collaboration template' })).toBeVisible();
    expect(screen.queryByTestId('template-editor-loading')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toHaveValue('');
    expect(collaborationApi.getTemplate).not.toHaveBeenCalled();
  });

  it('uses a five-section form directory and shows deterministic graph errors without a canvas', async () => {
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue({
      ...template,
      definition: {
        ...validDefinition,
        dependencies: [
          { from: 'draft', to: 'review', mode: 'all' },
          { from: 'review', to: 'draft', mode: 'all' },
        ],
      },
    });
    renderEditor();
    expect(await screen.findByRole('navigation', { name: 'Template sections' })).toBeVisible();
    for (const label of ['Overview', 'Inputs', 'Roles', 'Flow', 'Outputs']) {
      expect(screen.getByRole('button', { name: label })).toBeVisible();
    }
    expect(screen.queryByTestId('workflow-canvas')).not.toBeInTheDocument();
    expect(await screen.findByText('Dependency cycle detected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });

  it('edits task input and upstream Artifact handoff contracts', async () => {
    renderEditor();
    await screen.findByDisplayValue('Custom workflow');
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    fireEvent.click(screen.getByRole('button', { name: /Agent review/u }));

    expect(screen.getByLabelText('Run input Work brief')).not.toBeChecked();
    expect(screen.getByLabelText('Upstream artifact Draft (draft)')).toBeChecked();
    expect(screen.getByLabelText('Require upstream artifact Draft (draft)')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Run input Work brief'));
    fireEvent.click(screen.getByLabelText('Require upstream artifact Draft (draft)'));

    expect(screen.getByLabelText('Run input Work brief')).toBeChecked();
    expect(screen.getByLabelText('Require upstream artifact Draft (draft)')).not.toBeChecked();
  });

  it('rejects a temporary output-key collision without corrupting another producer handoff', async () => {
    renderEditor();
    await screen.findByDisplayValue('Custom workflow');
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    const outputKey = screen.getByLabelText('Output key');
    fireEvent.change(outputKey, { target: { value: 'review' } });
    expect(outputKey).toHaveValue('draft');
    fireEvent.change(outputKey, { target: { value: 'draft-v2' } });
    fireEvent.click(screen.getByRole('button', { name: /Agent review/u }));
    expect(screen.getByLabelText('Upstream artifact Draft (draft-v2)')).toBeChecked();
  });

  it('localizes custom duplicate graph validation', () => {
    expect(issueLabel(
      { code: 'custom', message: 'Duplicate output key: draft' },
      (key) => key === 'collaboration.validation.KEY_DUPLICATE' ? '工作流中存在重复标识符' : key,
    )).toBe('工作流中存在重复标识符');
    const customCases = [
      ['Dependency references an unknown node: missing->task', 'DEPENDENCY_NODE_MISSING'],
      ['Incoming dependency modes cannot mix for node: task', 'DEPENDENCY_MODE_CONFLICT'],
      ['Every Agent task requires at least one required Todo', 'REQUIRED_TODO_MISSING'],
      ['Unknown input key: brief', 'INPUT_KEY_MISSING'],
      ['Review artifact source task cannot be skippable: draft', 'REVIEW_SOURCE_TASK_SKIPPABLE'],
      ['Required artifact is not guaranteed before the consumer becomes ready: draft', 'ANY_REQUIRED_ARTIFACT_UNSAFE'],
      ['Unexpected future schema rule', 'SCHEMA_INVALID'],
    ] as const;
    for (const [message, code] of customCases) {
      expect(issueLabel(
        { code: 'custom', message },
        (key) => key === `collaboration.validation.${code}` ? `translated:${code}` : key,
      )).toBe(`translated:${code}`);
    }
  });

  it('keeps eligible reviewers across same-Space template navigation and blocks low roles', async () => {
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'viewer-1', role: 'viewer', user: { id: 'viewer-1', email: 'viewer@example.test', name: 'Viewer' } },
      { type: 'human', userId: 'editor-1', role: 'editor', user: { id: 'editor-1', email: 'editor@example.test', name: 'Editor' } },
    ]);
    vi.mocked(collaborationApi.getTemplate)
      .mockResolvedValueOnce({ ...template, id: 'template-old', definition: reviewedDefinition() })
      .mockResolvedValueOnce({ ...template, id: 'template-new', name: 'New workflow', definition: reviewedDefinition() });
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-old']}>
      <Routes><Route path="/spaces/:id/collaboration/templates/:templateId" element={<NavigationEditor />} /></Routes>
    </MemoryRouter></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open new template' }));
    await screen.findByDisplayValue('New workflow');
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    fireEvent.click(screen.getByRole('button', { name: /Human gate/u }));
    expect(screen.getByRole('checkbox', { name: 'Viewer (viewer)' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Editor (editor)' })).toBeEnabled();
  });

  it('shows a removable stale reviewer reference', async () => {
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue({ ...template, definition: reviewedDefinition(['removed-user']) });
    renderEditor();
    await screen.findByDisplayValue('Custom workflow');
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    fireEvent.click(screen.getByRole('button', { name: /Human gate/u }));
    const removed = screen.getByRole('checkbox', { name: /removed-user.*no longer a current member/u });
    expect(removed).toBeChecked();
    fireEvent.click(removed);
    expect(removed).not.toBeChecked();
  });

  it('offers explicit retry when reviewer or server validation loading fails', async () => {
    vi.mocked(collaborationApi.listMembers)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    vi.mocked(collaborationApi.validateTemplate)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ valid: true, issues: [] });
    renderEditor();

    const memberAlert = await screen.findByRole('alert');
    expect(memberAlert).toHaveTextContent('Failed to load Space reviewers.');
    fireEvent.click(within(memberAlert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Server validation is temporarily unavailable.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(collaborationApi.validateTemplate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Server validation is temporarily unavailable.')).not.toBeInTheDocument());
  });

  it('preserves designated reviewer IDs when member eligibility could not be loaded', async () => {
    vi.mocked(collaborationApi.listMembers).mockRejectedValue(new Error('offline'));
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue({
      ...template,
      definition: reviewedDefinition(['admin-reviewer']),
    });
    renderEditor();

    await screen.findByDisplayValue('Custom workflow');
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    fireEvent.click(screen.getByRole('button', { name: /Human gate/u }));
    const reviewer = screen.getByRole('checkbox', { name: /admin-reviewer.*no longer a current member/u });
    expect(reviewer).toBeChecked();
    fireEvent.change(screen.getByLabelText('Minimum reviewer role'), { target: { value: 'admin' } });
    expect(reviewer).toBeChecked();
  });

  it('saves metadata and the form definition with optimistic versioning', async () => {
    renderEditor();
    await screen.findByDisplayValue('Custom workflow');
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Release workflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(collaborationApi.updateTemplate).toHaveBeenCalledWith('space-1', 'template-1', expect.objectContaining({
      expectedVersion: 1, name: 'Release workflow', description: 'Description', definition: validDefinition,
    })));
    expect(await screen.findByRole('status')).toHaveTextContent('Template saved');
  });
});
