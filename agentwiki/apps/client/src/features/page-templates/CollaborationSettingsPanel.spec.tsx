import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { CollaborationSettingsPanel } from './CollaborationSettingsPanel';

describe('CollaborationSettingsPanel', () => {
  it('collects required workflow inputs, task selection, mappings and shows authoritative deduplicated participants', () => {
    const onChange = vi.fn();
    render(<LanguageProvider><CollaborationSettingsPanel
      spaceId="space-1"
      roles={[{ id: 'owner', name: '项目负责人', description: '负责交付', required: true }]}
      inputs={[{ key: 'project-brief', label: '项目简述', type: 'short_text', required: true }]}
      tasks={[{ nodeId: 'task-a', name: '写方案', roleSlotId: 'owner' }, { nodeId: 'task-b', name: '审风险', roleSlotId: 'owner' }]}
      agents={[
        { type: 'human', userId: 'human-1', role: 'owner', user: { id: 'human-1', name: 'Human', email: 'human@example.com' } },
        { type: 'agent', agentId: 'agent-1', role: 'editor', agent: { id: 'agent-1', name: 'Alpha', status: 'active', connected: true } },
      ]}
      bindings={[]}
      inputValues={{}}
      enabledTaskNodeIds={['task-a', 'task-b']}
      participants={['agent-1']}
      onChange={onChange}
    /></LanguageProvider>);
    expect(screen.getByLabelText('项目简述')).toBeRequired();
    expect(screen.getByRole('checkbox', { name: '写方案' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '审风险' })).toBeChecked();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(within(screen.getByTestId('participant-preview')).getAllByText('Alpha')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: 'agent-1' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bindings: [expect.objectContaining({ agentId: 'agent-1' })] }));
  });

  it('shows invalid Agent choices disabled with a reason', () => {
    render(<LanguageProvider><CollaborationSettingsPanel
      spaceId="space-1"
      roles={[{ id: 'owner', name: '负责人', description: '', required: true }]}
      inputs={[]} tasks={[]}
      agents={[{ type: 'agent', agentId: 'reader-1', role: 'reader', agent: { id: 'reader-1', name: 'Reader', status: 'active' } }]}
      bindings={[]} inputValues={{}} enabledTaskNodeIds={[]} participants={[]}
      onChange={() => undefined}
    /></LanguageProvider>);
    expect(screen.getByRole('option', { name: /Reader.*Reader/ })).toBeDisabled();
  });
});
