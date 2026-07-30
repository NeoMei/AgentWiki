import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { AddSpaceMemberDialog, type AddSpaceMemberDialogProps } from './AddSpaceMemberDialog';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const onClose = vi.fn();
const onAdded = vi.fn();

const renderDialog = (overrides: Partial<AddSpaceMemberDialogProps> = {}) => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AddSpaceMemberDialog
      spaceId="space-1"
      canGrantOwner
      existingAgentIds={[]}
      zh
      onClose={onClose}
      onAdded={onAdded}
      {...overrides}
    />
  </MemoryRouter>,
);

describe('AddSpaceMemberDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
    vi.mocked(api.put).mockResolvedValue({ data: {} } as never);
    onAdded.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('keeps the existing human email flow', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('用户邮箱 *'), {
      target: { value: 'member@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-1/members', {
      email: 'member@example.com', role: 'viewer',
    }));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows only active ungranted owned agents', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { id: 'agent-new', name: 'New agent', status: 'active', revokedAt: null },
      { id: 'agent-existing', name: 'Existing agent', status: 'active', revokedAt: null },
      { id: 'agent-paused', name: 'Paused agent', status: 'paused', revokedAt: null },
    ] } as never);
    renderDialog({ existingAgentIds: ['agent-existing'] });

    fireEvent.click(screen.getByRole('button', { name: '智能体' }));

    expect(await screen.findByRole('option', { name: 'New agent · 已启用' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Existing agent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Paused agent/ })).not.toBeInTheDocument();
  });

  it('adds an editor agent with editor default scopes', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { id: 'agent-new', name: 'New agent', status: 'active', revokedAt: null },
    ] } as never);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '智能体' }));
    await screen.findByRole('option', { name: 'New agent · 已启用' });
    fireEvent.change(screen.getByLabelText('智能体角色'), { target: { value: 'editor' } });
    fireEvent.click(screen.getByRole('button', { name: '添加智能体' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/agents/agent-new/grants/space-1',
      {
        role: 'editor',
        scopes: ['pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write'],
      },
    ));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes the selected member mode accessibly', () => {
    renderDialog();
    const human = screen.getByRole('button', { name: '用户' });
    const agent = screen.getByRole('button', { name: '智能体' });

    expect(human).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(agent);
    expect(agent).toHaveAttribute('aria-pressed', 'true');
    expect(human).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders an empty state and disables agent submission', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '智能体' }));

    expect(await screen.findByText('没有可添加的智能体')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往智能体管理' })).toHaveAttribute('href', '/agents');
    expect(screen.getByRole('button', { name: '添加智能体' })).toBeDisabled();
  });

  it('shows a retry action when loading agents fails', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [] } as never);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '智能体' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('没有可添加的智能体')).toBeInTheDocument();
  });

  it('keeps the dialog open and clears the submit error when switching modes', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { id: 'agent-new', name: 'New agent', status: 'active', revokedAt: null },
    ] } as never);
    vi.mocked(api.put).mockRejectedValue(new Error('failed'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '智能体' }));
    await screen.findByRole('option', { name: 'New agent · 已启用' });
    fireEvent.click(screen.getByRole('button', { name: '添加智能体' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('智能体添加失败');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '用户' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('only offers the owner role when the caller may grant it', () => {
    const view = renderDialog({ canGrantOwner: false });
    expect(screen.queryByRole('option', { name: '所有者' })).not.toBeInTheDocument();
    view.unmount();

    renderDialog({ canGrantOwner: true });
    expect(screen.getByRole('option', { name: '所有者' })).toBeInTheDocument();
  });

  it('renders equivalent English controls', async () => {
    renderDialog({ zh: false });
    expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

    expect(await screen.findByText('No available agents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeDisabled();
  });
});
