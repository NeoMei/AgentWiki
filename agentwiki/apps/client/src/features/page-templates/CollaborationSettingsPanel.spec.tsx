import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { CollaborationSettingsPanel } from './CollaborationSettingsPanel';

const preparation = vi.hoisted(() => ({
  latest: null as null | { onPrepared: (selection: { agentId: string; agentName: string; connection: 'connected' | 'pending' }) => Promise<void> },
}));

vi.mock('../collaboration/components/AgentPreparationDialog', () => ({
  AgentPreparationDialog: (props: typeof preparation.latest) => {
    preparation.latest = props;
    return <div role="dialog" aria-label="Agent preparation" />;
  },
}));

describe('CollaborationSettingsPanel', () => {
  beforeEach(() => {
    preparation.latest = null;
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

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
      onRefreshAgents={async () => []}
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
      onRefreshAgents={async () => []}
      onChange={() => undefined}
    /></LanguageProvider>);
    expect(screen.getByRole('option', { name: /Reader.*Reader/ })).toBeDisabled();
  });

  it('keeps a cleared numeric workflow input missing instead of converting it to zero', () => {
    const onChange = vi.fn();
    render(<LanguageProvider><CollaborationSettingsPanel
      spaceId="space-1" roles={[]}
      inputs={[{ key: 'limit', label: '数量', type: 'number', required: true }]}
      tasks={[]} agents={[]} bindings={[]} inputValues={{ limit: 3 }}
      enabledTaskNodeIds={[]} participants={[]}
      onRefreshAgents={async () => []} onChange={onChange}
    /></LanguageProvider>);

    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ inputValues: {} }));
  });

  it('refreshes authoritative members and reconciles a prepared Agent before binding it', async () => {
    const refreshed = [{
      type: 'agent' as const, agentId: 'agent-new', role: 'editor',
      agent: { id: 'agent-new', name: 'Authoritative Alpha', status: 'active', connected: true },
    }];
    const refresh = vi.fn().mockResolvedValue(refreshed);
    const Harness = () => {
      const [agents, setAgents] = useState<any[]>([]);
      const [bindings, setBindings] = useState<any[]>([]);
      return <CollaborationSettingsPanel spaceId="space-1"
        roles={[{ id: 'owner', name: '负责人', description: '', required: true }]}
        inputs={[]} tasks={[]} agents={agents} bindings={bindings} inputValues={{}}
        enabledTaskNodeIds={[]} participants={['agent-new']}
        onRefreshAgents={async () => {
          const next = await refresh();
          setAgents(next);
          return next;
        }}
        onChange={(value) => setBindings(value.bindings)} />;
    };
    render(<LanguageProvider><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: '为“负责人”准备 Agent' }));
    await act(async () => preparation.latest?.onPrepared({
      agentId: 'agent-new', agentName: 'Untrusted local name', connection: 'connected',
    }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: '负责人' })).toHaveValue('agent-new');
    expect(screen.getByRole('option', { name: 'Authoritative Alpha' })).toBeVisible();
    expect(within(screen.getByTestId('participant-preview')).getByText('Authoritative Alpha')).toBeVisible();
  });
});
