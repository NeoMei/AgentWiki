import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { AgentAssistPanel } from './AgentAssistPanel';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'QA' } }),
}));

const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, (data: any) => void>();
  return {
    handlers,
    socket: {
      on: vi.fn((event: string, handler: (data: any) => void) => { handlers.set(event, handler); }),
      emit: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock('socket.io-client', () => ({ io: () => socketMock.socket }));

const successfulTask = {
  id: 'task-done',
  intent: 'Improve this page',
  status: 'done',
  result: {
    changes: '# Improved',
    model: 'opencode/big-pickle',
    modelTier: 'free',
    attemptCount: 2,
    usage: { total: 8648 },
    cost: 0,
  },
};

const renderPanel = (props: { onApply?: (changes: string) => void } = {}) => render(
  <AgentAssistPanel
    pageId="page-1"
    pageTitle="Page"
    spaceId="space-1"
    snapshot={() => ({ title: 'Page', content: 'Content' })}
    onApply={props.onApply}
  />,
);

describe('AgentAssistPanel routing metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketMock.handlers.clear();
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/assist/tasks') return Promise.resolve({ data: [successfulTask] });
      if (url === '/review') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  afterEach(cleanup);

  it('hides the provider model name and shows a friendly completion label in English', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);

    renderPanel();

    expect(await screen.findByText('Generated')).toBeInTheDocument();
    // The raw provider model name must never be visible to the user.
    expect(screen.queryByText(/opencode|big-pickle|free|paid|tokens|\$\d/u))
      .not.toBeInTheDocument();
  });

  it('shows historical completed tasks without applying them', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn();
    renderPanel({ onApply });
    expect(await screen.findByText('Generated')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies only a task submitted during this mount and only once', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn();
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new', status: 'queued' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [],
    }));
    renderPanel({ onApply });
    await screen.findByText('Generated');
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('# Improved'));
    fireEvent.click(screen.getByLabelText('refresh'));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  });

  it('does not stream historical or collaborator tasks into the editor', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onStreamUpdate = vi.fn();
    render(<AgentAssistPanel
      pageId="page-1"
      pageTitle="Page"
      spaceId="space-1"
      snapshot={() => ({ title: 'Page', content: 'Content' })}
      onStreamUpdate={onStreamUpdate}
    />);
    await screen.findByText('Generated');

    act(() => socketMock.handlers.get('assistStream')?.({
      taskId: 'task-done',
      chunk: '📝 生成: {"changes":"# Stale collaborator content"}',
    }));

    expect(onStreamUpdate).not.toHaveBeenCalled();
  });

  it('hides the provider model name and shows a friendly completion label in Chinese', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'zh-CN' } as ReturnType<typeof useLanguage>);

    renderPanel();

    expect(await screen.findByText('已生成')).toBeInTheDocument();
    expect(screen.queryByText(/opencode|big-pickle|免费|付费|tokens/u))
      .not.toBeInTheDocument();
  });

  it('shows a friendly error message without raw provider details or codes', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/assist/tasks') return Promise.resolve({ data: [{
        id: 'task-failed',
        intent: 'Improve this page',
        status: 'failed',
        error: 'provider response with sk-fake-secret',
        result: {
          model: 'provider/paid-model',
          modelTier: 'paid',
          attemptCount: 1,
          usage: { total: 12 },
          cost: 0.5,
          attempts: [{ errorCode: 'binary_unavailable' }],
          raw: 'raw authentication detail',
        },
      }] });
      if (url === '/review') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    renderPanel();

    // A friendly message is shown instead of the raw error code.
    expect(await screen.findByText('Assistant temporarily unavailable, please retry'))
      .toBeInTheDocument();
    // Raw provider details, model names, costs, and error codes are never exposed.
    expect(screen.queryByText(/provider|paid-model|Paid|tokens|\$0\.5|binary_unavailable|auth_failed|raw authentication/u))
      .not.toBeInTheDocument();
  });
});
