import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalSyncGuideSection, LOCAL_SYNC_PACKAGE_URL } from './LocalSyncGuideSection';

describe('LocalSyncGuideSection', () => {
  it('shows the verified Chinese workflow and safe defaults', () => {
    render(<LocalSyncGuideSection zh />);

    expect(screen.getByRole('heading', { name: '从本地知识创建 Wiki' })).toBeInTheDocument();
    expect(screen.getByText('@neomei/agentwiki-local-sync')).toBeInTheDocument();
    expect(screen.getByText('版本 0.1.0')).toBeInTheDocument();
    expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/其他兼容 stdio MCP/)).toBeInTheDocument();
    expect(screen.getByText(/安装只建立连接，不会自动扫描或上传/)).toBeInTheDocument();
    expect(screen.getByText(/是否同步到 AgentWiki/)).toBeInTheDocument();

    const npm = screen.getByRole('link', { name: '在 npm 上查看' });
    expect(npm).toHaveAttribute('href', LOCAL_SYNC_PACKAGE_URL);
    expect(npm).toHaveAttribute('target', '_blank');
    expect(npm).toHaveAttribute('rel', 'noopener noreferrer');

    const advanced = screen.getByText('高级命令').closest('details');
    expect(advanced).not.toHaveAttribute('open');
    fireEvent.click(within(advanced as HTMLElement).getByText('高级命令'));
    expect(advanced).toHaveAttribute('open');
    for (const command of ['doctor', 'inspect', 'scan', 'preview', 'sync --confirm', 'upgrade', 'uninstall']) {
      expect(within(advanced as HTMLElement).getByText(command)).toBeInTheDocument();
    }
  });

  it('renders English copy and real screenshot paths', () => {
    render(<LocalSyncGuideSection zh={false} />);

    expect(screen.getByRole('heading', { name: 'Create a Wiki from Local Knowledge' })).toBeInTheDocument();
    expect(screen.getByText(/Installation only establishes the connection/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Generated AgentWiki Local Sync instructions' }))
      .toHaveAttribute('src', '/screenshots/local-sync-installation.png');
    expect(screen.getByRole('img', { name: 'Local Agent knowledge preview awaiting confirmation' }))
      .toHaveAttribute('src', '/screenshots/local-sync-agent-preview.png');
    expect(screen.getByRole('img', { name: 'Local Agent sync completion result' }))
      .toHaveAttribute('src', '/screenshots/local-sync-agent-success.png');
    expect(screen.getByRole('img', { name: 'AgentWiki page published from local knowledge' }))
      .toHaveAttribute('src', '/screenshots/local-sync-published-page.png');
  });
});
