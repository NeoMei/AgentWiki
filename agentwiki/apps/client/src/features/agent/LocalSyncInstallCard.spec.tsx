import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { LocalSyncInstallCard } from './LocalSyncInstallCard';

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

const instruction = '# 接入\nnpx --yes @neomei/agentwiki-local-sync@0.4.0 onboard --server https://wiki.test/api --code AW-ABCD-EFGH --protocol ndjson --agent auto';

const renderCard = () => render(
  <LanguageProvider>
    <LocalSyncInstallCard agentId="agent-1" />
  </LanguageProvider>,
);

const generate = async () => {
  fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));
  await screen.findByText(/@neomei\/agentwiki-local-sync@0\.4\.0/);
};

describe('LocalSyncInstallCard', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.post).mockReset();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.mocked(api.post).mockResolvedValue({ data: {
      installationId: 'install-1',
      code: 'AW-ABCD-EFGH',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      instructions: instruction,
    } } as any);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('generates a short-lived instruction without rendering a permanent key', async () => {
    renderCard();

    await generate();

    expect(api.post).toHaveBeenCalledWith('/agents/agent-1/local-sync-installations', {
      pluginVersion: '0.4.0',
      scopes: ['spaces:read', 'pages:read', 'sources:read', 'sources:write', 'runs:read', 'runs:write', 'review:read'],
    });
    expect(screen.queryByText(/agk_/)).not.toBeInTheDocument();
    expect(screen.getByText(/onboard --server/)).toBeInTheDocument();
    expect(screen.queryByText(/\bconnect\b/)).not.toBeInTheDocument();
  });

  it('adds auto-publish only when the user opts in', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('checkbox', { name: '允许符合空间策略时直接发布' }));
    fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({
      scopes: expect.arrayContaining(['review:auto-publish']),
    });
  });

  it('copies the complete instruction and shows expiration', async () => {
    renderCard();

    await generate();
    fireEvent.click(screen.getByRole('button', { name: '复制接入指令' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(instruction);
    expect(screen.getByText(/10 分钟/)).toBeInTheDocument();
  });

  it('disables the generate button while the request is pending', () => {
    let resolve!: (value: any) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((done) => { resolve = done; }) as any);
    renderCard();

    const button = screen.getByRole('button', { name: '生成统一网关接入指令' });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    resolve({ data: {} });
  });

  it('shows a stable server error message', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: '无法生成安装码' } } });
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('disables an expired instruction and offers regeneration', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {
      installationId: 'install-1',
      code: 'AW-ABCD-EFGH',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      instructions: instruction,
    } } as any);
    renderCard();

    await generate();

    expect(screen.getByText('接入指令已过期。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制接入指令' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  });

  it('treats an invalid expiration timestamp as expired instead of starting an invalid timer', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {
      installationId: 'install-1',
      expiresAt: 'not-a-date',
      instructions: instruction,
    } } as any);
    renderCard();

    await generate();

    expect(screen.getByText('接入指令已过期。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制接入指令' })).toBeDisabled();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('clears the countdown timer when unmounted', async () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const view = renderCard();

    await generate();
    view.unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('renders equivalent accessible names in English', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    renderCard();

    expect(screen.getByRole('checkbox', { name: 'Allow direct publishing when space policy permits' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate unified gateway instructions' })).toBeInTheDocument();
  });
});
