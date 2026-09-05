import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { validDefinition } from '../collaboration-test-fixtures';
import { RoleBindingEditor } from './RoleBindingEditor';

describe('RoleBindingEditor', () => {
  it('can present an invalid Agent as disabled with an explicit reason', () => {
    render(<RoleBindingEditor
      roleSlots={[validDefinition.roleSlots[0]]}
      agents={[{
        type: 'agent', agentId: 'agent-1', role: 'reader',
        agent: { id: 'agent-1', name: 'Agent One', status: 'active' },
      }]}
      bindings={[]}
      onChange={() => undefined}
      chooseLabel="Choose"
      agentAvailability={{ 'agent-1': { disabled: true, reason: 'Reader cannot execute' } }}
    />);
    expect(screen.getByRole('option', { name: 'Agent One — Reader cannot execute' })).toBeDisabled();
  });
  it('reports the exact Role Slot when Prepare Agent is chosen', () => {
    const onPrepare = vi.fn();
    render(<RoleBindingEditor
      roleSlots={validDefinition.roleSlots}
      agents={[]}
      bindings={[]}
      onChange={vi.fn()}
      onPrepare={onPrepare}
      chooseLabel="Choose Agent"
      prepareLabel="Prepare Agent"
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Agent for Writer' }));
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(onPrepare).toHaveBeenCalledWith('writer');
  });

  it('uses an explicit select label and never nests the action button in it', () => {
    render(<RoleBindingEditor
      roleSlots={validDefinition.roleSlots}
      agents={[]}
      bindings={[]}
      onChange={vi.fn()}
      onPrepare={vi.fn()}
      chooseLabel="Choose Agent"
      prepareLabel="Prepare Agent"
    />);

    const writerSelect = screen.getByLabelText('Writer') as HTMLSelectElement;
    const writerAction = screen.getByRole('button', { name: 'Prepare Agent for Writer' });
    expect(writerSelect).toHaveAttribute('id', 'role-binding-writer');
    expect(writerSelect.labels).toContain(screen.getByText('Writer'));
    expect(writerAction.closest('label')).toBeNull();
    expect(writerAction.parentElement).toHaveClass('flex-wrap');
  });

  it('supports a localized action label for each Role Slot', () => {
    render(<RoleBindingEditor
      roleSlots={validDefinition.roleSlots}
      agents={[]}
      bindings={[]}
      onChange={vi.fn()}
      onPrepare={vi.fn()}
      chooseLabel="选择 Agent"
      prepareLabel="准备 Agent"
      prepareActionLabel={(role) => `为“${role}”准备 Agent`}
    />);

    expect(screen.getByRole('button', { name: '为“Writer”准备 Agent' })).toBeVisible();
  });
});
