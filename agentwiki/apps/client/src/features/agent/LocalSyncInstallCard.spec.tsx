import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { LocalSyncInstallCard } from './LocalSyncInstallCard';

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

const instruction = '# 接入\nnpx --yes @neomei/agentwiki-local-sync@0.5.0 onboard --server https://wiki.test/api --code AW-ABCD-EFGH --protocol ndjson --agent auto';

const renderCard = ({
  agentId = 'agent-1',
  spaces = [{ id: 'space-1', name: '团队知识库' }],
  grants = [{ spaceId: 'space-1', role: 'reader' as const, space: { id: 'space-1', name: '团队知识库' } }],
} = {}) => render(
  <LanguageProvider>
    <LocalSyncInstallCard agentId={agentId} spaces={spaces} grants={grants} />
  </LanguageProvider>,
);

const generate = async () => {
  fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));
  await screen.findByText(/@neomei\/agentwiki-local-sync@0\.5\.0/);
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

  it('generates an editor connection intent for the selected Space', async () => {
    renderCard();

    fireEvent.change(screen.getByLabelText('空间'), { target: { value: 'space-1' } });
    fireEvent.change(screen.getByLabelText('Agent 角色'), { target: { value: 'editor' } });
    expect(screen.getByText(/Reader.*Editor/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/agents/agent-1/local-sync-installations',
      { pluginVersion: '0.5.0', spaceId: 'space-1', role: 'editor' },
    ));
  });

  it('shows the publisher governance warning', () => {
    renderCard({
      spaces: [{ id: 'space-1', name: 'S' }],
      grants: [],
    });

    fireEvent.change(screen.getByLabelText('Agent 角色'), { target: { value: 'publisher' } });

    expect(screen.getByText(/仍受 Space 发布策略限制/)).toBeInTheDocument();
    expect(screen.getByText(/不能执行人工审批或成员管理/)).toBeInTheDocument();
  });

  it('generates a short-lived instruction without rendering a permanent key', async () => {
    renderCard();

    await generate();

    expect(screen.queryByText(/agk_/)).not.toBeInTheDocument();
    expect(screen.getByText(/onboard --server/)).toBeInTheDocument();
    expect(screen.queryByText(/\bconnect\b/)).not.toBeInTheDocument();
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

    expect(screen.getByRole('combobox', { name: 'Space' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Agent role' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate unified gateway instructions' })).toBeInTheDocument();
  });
});
