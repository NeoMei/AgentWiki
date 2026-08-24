import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { LocalSyncInstallCard } from './LocalSyncInstallCard';

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

const instruction = '# 接入\nnpx --yes @neomei/agentwiki-local-sync@0.6.1 onboard --server https://wiki.test/api --code AW-ABCD-EFGH --protocol ndjson --agent auto';

const renderCard = ({
  agentId = 'agent-1',
  spaces = [{ id: 'space-1', name: '团队知识库' }],
  grants = [{ spaceId: 'space-1', role: 'reader' as const, space: { id: 'space-1', name: '团队知识库' } }],
}: {
  agentId?: string;
  spaces?: Array<{ id: string; name: string }>;
  grants?: Array<{
    spaceId: string;
    role: AgentAccessRole;
    space: { id: string; name: string };
  }>;
} = {}) => render(
  <LanguageProvider>
    <LocalSyncInstallCard agentId={agentId} spaces={spaces} grants={grants} />
  </LanguageProvider>,
);

const generate = async () => {
  fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));
  await screen.findByText(/@neomei\/agentwiki-local-sync@0\.6\.1/);
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
      { pluginVersion: '0.6.1', spaceId: 'space-1', role: 'editor' },
    ));
  });

  it('defaults the role selector to the selected Space authorization', async () => {
    renderCard({
      spaces: [
        { id: 'space-1', name: '编辑空间' },
        { id: 'space-2', name: '发布空间' },
      ],
      grants: [
        { spaceId: 'space-1', role: 'editor', space: { id: 'space-1', name: '编辑空间' } },
        { spaceId: 'space-2', role: 'publisher', space: { id: 'space-2', name: '发布空间' } },
      ],
    });

    expect(screen.getByRole('combobox', { name: 'Agent 角色' })).toHaveValue('editor');
    expect(screen.queryByText(/当前角色为 Editor/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '空间' }), {
      target: { value: 'space-2' },
    });

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent 角色' })).toHaveValue('publisher'));
    expect(screen.queryByText(/当前角色为 Publisher/)).not.toBeInTheDocument();
  });

  it('does not overwrite an unsubmitted role choice when equivalent grant props rerender', () => {
    const props = {
      agentId: 'agent-1',
      spaces: [{ id: 'space-1', name: '团队知识库' }],
      grants: [{ spaceId: 'space-1', role: 'editor' as const, space: { id: 'space-1', name: '团队知识库' } }],
    };
    const view = render(
      <LanguageProvider>
        <LocalSyncInstallCard {...props} />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Agent 角色' }), {
      target: { value: 'publisher' },
    });
    view.rerender(
      <LanguageProvider>
        <LocalSyncInstallCard {...props} grants={[...props.grants]} />
      </LanguageProvider>,
    );

    expect(screen.getByRole('combobox', { name: 'Agent 角色' })).toHaveValue('publisher');
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

  it('explains why no Space can be selected for authorization', () => {
    renderCard({ spaces: [], grants: [] });

    expect(screen.getByText('你需要先成为某个空间的所有者或管理员，才能为 Agent 生成该空间的接入授权。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成统一网关接入指令' })).toBeDisabled();
  });

  it('shows a safe server explanation when connection authorization fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { message: '你已不再是该空间的管理员' } },
    });
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('你已不再是该空间的管理员');
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

  it('discards generated instructions when the selected role changes', async () => {
    renderCard();
    await generate();

    fireEvent.change(screen.getByRole('combobox', { name: 'Agent 角色' }), {
      target: { value: 'editor' },
    });

    await waitFor(() => {
      expect(screen.queryByText(/onboard --server/)).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '生成统一网关接入指令' })).toBeInTheDocument();
  });

  it('moves to an available Space when the selected Space disappears', async () => {
    const view = renderCard({
      spaces: [
        { id: 'space-1', name: '旧空间' },
        { id: 'space-2', name: '备用空间' },
      ],
      grants: [],
    });
    fireEvent.change(screen.getByRole('combobox', { name: '空间' }), {
      target: { value: 'space-1' },
    });

    view.rerender(
      <LanguageProvider>
        <LocalSyncInstallCard
          agentId="agent-1"
          spaces={[{ id: 'space-2', name: '备用空间' }]}
          grants={[]}
        />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: '空间' })).toHaveValue('space-2'));
    fireEvent.click(screen.getByRole('button', { name: '生成统一网关接入指令' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/agents/agent-1/local-sync-installations',
      { pluginVersion: '0.6.1', spaceId: 'space-2', role: 'reader' },
    ));
  });
});
