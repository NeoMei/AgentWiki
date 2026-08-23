import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { TemplateEditor } from './TemplateEditor';
import type { TemplateDetail } from './types';
import { validDefinition } from './collaboration-test-fixtures';

vi.mock('./api', () => ({ collaborationApi: {
  getTemplate: vi.fn(), validateTemplate: vi.fn(), updateTemplate: vi.fn(), createTemplate: vi.fn(),
} }));

const template: TemplateDetail = {
  id: 'template-1', spaceId: 'space-1', slug: 'custom', name: 'Custom workflow', description: 'Description',
  system: false, version: 1, definition: validDefinition,
};

function renderEditor() {
  localStorage.setItem('agentwiki.language.v1', 'en');
  return render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/collaboration/templates/template-1']}>
    <Routes><Route path="/spaces/:id/collaboration/templates/:templateId" element={<TemplateEditor />} /></Routes>
  </MemoryRouter></LanguageProvider>);
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collaborationApi.getTemplate).mockResolvedValue(template);
    vi.mocked(collaborationApi.validateTemplate).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(collaborationApi.updateTemplate).mockResolvedValue({ ...template, version: 2, name: 'Release workflow' });
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
