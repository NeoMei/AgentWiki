import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { NoteCollaboratorPicker } from './NoteCollaboratorPicker';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));

afterEach(() => cleanup());

describe('NoteCollaboratorPicker', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { type: 'human', userId: 'u1', role: 'editor', user: { id: 'u1', type: 'human', name: 'Alice', email: 'alice@example.com' } },
      { type: 'human', userId: 'u2', role: 'viewer', user: { id: 'u2', type: 'human', name: 'Bob', email: 'bob@example.com' } },
      { type: 'agent', agentId: 'a1', agent: { name: 'Codex' } },
    ] } as any);
  });

  it('loads only human members, searches, selects and removes collaborators', async () => {
    const onChange = vi.fn();
    render(<NoteCollaboratorPicker spaceId="space-1" language="en" selectedUserIds={[]} onChange={onChange} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/spaces/space-1/members'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Space collaborators' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: /Alice/ })).toBeVisible();
    expect(within(list).queryByRole('option', { name: /Codex/ })).not.toBeInTheDocument();
    fireEvent.change(within(list).getByRole('textbox', { name: 'Search collaborators' }), { target: { value: 'bob' } });
    expect(within(list).queryByRole('option', { name: /Alice/ })).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('option', { name: /Bob/ }));
    expect(onChange).toHaveBeenCalledWith(['u2']);
  });

  it('opens from the composer @ trigger signal', async () => {
    const { rerender } = render(<NoteCollaboratorPicker spaceId="space-1" language="en" selectedUserIds={[]} onChange={vi.fn()} openSignal={0} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    rerender(<NoteCollaboratorPicker spaceId="space-1" language="en" selectedUserIds={[]} onChange={vi.fn()} openSignal={1} />);
    expect(screen.getByRole('listbox')).toBeVisible();
  });
});
