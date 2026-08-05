import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { AgentAssistPanel } from './AgentAssistPanel';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: vi.fn() }));

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

const renderPanel = () => render(
  <AgentAssistPanel
    pageId="page-1"
    pageTitle="Page"
    spaceId="space-1"
    snapshot={() => ({ title: 'Page', content: 'Content' })}
  />,
);

describe('AgentAssistPanel routing metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/assist/tasks') return Promise.resolve({ data: [successfulTask] });
      if (url === '/review') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  afterEach(cleanup);

  it('renders compact English model, attempts, token, and actual-cost metadata', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);

    renderPanel();

    expect(await screen.findByText(
      'opencode/big-pickle · Free · 2 attempts · 8,648 tokens · $0.000000',
    )).toBeInTheDocument();
  });

  it('renders the free tier and attempt count in Chinese', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'zh-CN' } as ReturnType<typeof useLanguage>);

    renderPanel();

    expect(await screen.findByText(/免费 · 2 次尝试/u)).toBeInTheDocument();
  });

  it('renders failed routing metadata and the sanitized error without raw provider details', async () => {
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
          attempts: [{ errorCode: 'auth_failed' }],
          raw: 'raw authentication detail',
        },
      }] });
      if (url === '/review') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    renderPanel();

    expect(await screen.findByText(
      'provider/paid-model · Paid · 1 attempt · 12 tokens · $0.500000',
    )).toBeInTheDocument();
    expect(screen.getByText('auth_failed')).toBeInTheDocument();
    expect(screen.queryByText(/provider response|raw authentication|sk-fake-secret/u))
      .not.toBeInTheDocument();
  });
});
