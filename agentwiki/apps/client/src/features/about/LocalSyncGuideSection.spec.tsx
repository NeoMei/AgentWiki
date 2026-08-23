import { fireEvent, render, screen, within } from '@testing-library/react';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_SYNC_PACKAGE_URL } from '../../config/localSync';
import { LocalSyncGuideSection } from './LocalSyncGuideSection';

describe('LocalSyncGuideSection', () => {
  it('shows the verified Chinese workflow and safe defaults', () => {
    render(<LocalSyncGuideSection zh />);

    expect(screen.getByRole('heading', { name: '从本地知识创建 Wiki' })).toBeInTheDocument();
    expect(screen.getByText('@neomei/agentwiki-local-sync')).toBeInTheDocument();
    expect(screen.getByText('版本 0.5.1')).toBeInTheDocument();
    expect(LOCAL_SYNC_PACKAGE_URL).toBe('https://www.npmjs.com/package/@neomei/agentwiki-local-sync/v/0.5.1');
    expect(screen.getByText(/已验证自动配置 Codex、Claude Code、OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/只安装一个名为 agentwiki 的 stdio MCP 网关/)).toBeInTheDocument();
    expect(screen.getByText(/安装只建立连接，不会自动扫描或上传/)).toBeInTheDocument();
    expect(screen.getByText(/使用远程模型前会单独说明提供方并再次询问/)).toBeInTheDocument();
    expect(screen.getByText(/是否同步到 AgentWiki/)).toBeInTheDocument();
    expect(screen.getByText(/当前对话明确同意后才会上传/)).toBeInTheDocument();
    expect(screen.getByText(/报告 Source、Run、ChangeSet 和审核状态，但不会替你审批/)).toBeInTheDocument();

    const npm = screen.getByRole('link', { name: '在 npm 上查看' });
    expect(npm).toHaveAttribute('href', LOCAL_SYNC_PACKAGE_URL);
    expect(npm).toHaveAttribute('target', '_blank');
    expect(npm).toHaveAttribute('rel', 'noopener noreferrer');

    const advanced = screen.getByText('统一网关工具').closest('details') as HTMLDetailsElement;
    const summary = within(advanced).getByText('统一网关工具');
    expect(advanced.tagName).toBe('DETAILS');
    expect(summary.tagName).toBe('SUMMARY');
    expect(advanced.open).toBe(false);
    fireEvent.click(summary);
    expect(advanced.open).toBe(true);
    expect(advanced).toHaveAttribute('open');
    for (const command of ['wiki_*', 'local_scan_sources', 'local_read_artifacts', 'knowledge_prepare', 'knowledge_confirm_and_sync', 'knowledge_pull']) {
      expect(within(advanced as HTMLElement).getByText(command)).toBeInTheDocument();
    }
    expect(within(advanced).getByText('wiki_*').closest('div')).toHaveClass('grid-cols-1', 'sm:grid-cols-[9rem_1fr]');
    expect(advanced.querySelector('dl')).not.toHaveClass('min-w-[32rem]');
  });

  it('renders English workflow and screenshot references with contain presentation', () => {
    const { container } = render(<LocalSyncGuideSection zh={false} />);

    expect(screen.getByRole('heading', { name: 'Create a Wiki from Local Knowledge' })).toBeInTheDocument();
    expect(screen.getByText(/Automatic setup is verified for Codex, Claude Code, and OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/one stdio MCP gateway named agentwiki/)).toBeInTheDocument();
    expect(screen.getByText(/Installation only establishes the connection/)).toBeInTheDocument();
    expect(screen.getByText(/Before using a remote model, the Agent discloses the provider and asks separately/)).toBeInTheDocument();
    expect(screen.getByText(/requires confirmation in the current conversation/)).toBeInTheDocument();
    expect(screen.getByText(/reports the Source, Run, ChangeSet, and review status but never approves for you/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Generated AgentWiki Local Sync instructions' }))
      .toHaveAttribute('src', '/screenshots/step4-generated-credential.png');
    expect(screen.getByRole('img', { name: 'Real local Agent workflow example in AgentWiki' }))
      .toHaveAttribute('src', '/screenshots/step5-opencode-publish.png');
    expect(screen.getByRole('img', { name: 'Real local Agent connection and publishing result' }))
      .toHaveAttribute('src', '/screenshots/step6-opencode-success.png');
    expect(screen.getByRole('img', { name: 'AgentWiki page published by a local Agent' }))
      .toHaveAttribute('src', '/screenshots/step6-published-page.png');
    const screenshots = within(container).getAllByRole('img');
    expect(screenshots).toHaveLength(4);
    for (const image of screenshots) {
      expect(image).toHaveClass('object-contain');
    }
  });

  it('references screenshot files that are shipped with the client', () => {
    const { container } = render(<LocalSyncGuideSection zh />);
    const screenshots = within(container).getAllByRole('img');

    for (const image of screenshots) {
      const src = image.getAttribute('src');
      expect(src).toMatch(/^\/screenshots\//u);
      expect(existsSync(path.resolve(process.cwd(), 'public', src!.slice(1))), src!).toBe(true);
    }
  });
});
