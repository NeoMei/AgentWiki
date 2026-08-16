import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_SYNC_PACKAGE_URL } from '../../config/localSync';
import { LanguageProvider } from '../../context/LanguageContext';
import { GuideLayout } from '../guide/GuideLayout';
import { GuideScreenshot } from './GuideScreenshot';
import { UsageGuide } from './UsageGuide';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

const renderGuide = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/guide']}>
      <GuideLayout><UsageGuide /></GuideLayout>
    </MemoryRouter>
  </LanguageProvider>,
);

describe('UsageGuide Agent connection flow', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('presents a generic Agent flow with OpenCode as the verified example', () => {
    renderGuide();

    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/?intent=workspace#login');
    expect(screen.getByRole('link', { name: '快速开始' })).toHaveAttribute('href', '/guide');
    expect(screen.getByRole('link', { name: 'Agent 自助接入' })).toHaveAttribute('href', '/guide/agent-onboard');
    expect(screen.getByRole('link', { name: 'Obsidian 插件' })).toHaveAttribute('href', '/guide/obsidian');
    expect(screen.getByRole('link', { name: '项目解读' })).toHaveAttribute('href', '/guide/docs');
    expect(screen.getByRole('heading', { name: '生成 Key 与接入指令' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '把接入指令交给本地 Agent' })).toBeInTheDocument();
    expect(screen.getByText(/把整段接入指令作为一条消息交给本地 Agent。AgentWiki 的接入方式不绑定具体产品，Codex、Claude Code、OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/以下以 OpenCode 为例/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '确认 Agent 接入与页面发布结果' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '已生成 Key 和接入指令' })).toHaveAttribute('src', '/screenshots/step4-generated-credential.png');
    expect(screen.getByRole('img', { name: 'OpenCode 发布页面过程' })).toHaveAttribute('src', '/screenshots/step5-opencode-publish.png');
    expect(screen.getByRole('img', { name: 'OpenCode 接入成功结果' })).toHaveAttribute('src', '/screenshots/step6-opencode-success.png');
    expect(screen.getByRole('img', { name: 'AgentWiki 已发布页面' })).toHaveAttribute('src', '/screenshots/step6-published-page.png');
    expect(screen.getByRole('img', { name: 'AgentWiki MCP 活动记录' })).toHaveAttribute('src', '/screenshots/step6-activity-log.png');
    expect(screen.getByRole('heading', { name: '从本地知识创建 Wiki' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在 npm 上查看' })).toHaveAttribute(
      'href',
      LOCAL_SYNC_PACKAGE_URL,
    );
    expect(screen.getByText(/安装只建立连接，不会自动扫描或上传/)).toBeInTheDocument();
  });
});

describe('GuideScreenshot', () => {
  it('renders default crop classes and accepts explicit display options', () => {
    const { rerender } = render(<GuideScreenshot src="/default.png" alt="默认截图" />);

    const image = screen.getByRole('img', { name: '默认截图' });
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveClass('object-cover', 'object-center');
    expect(image.parentElement).toHaveClass('h-56', 'sm:h-72');

    rerender(
      <GuideScreenshot
        src="/custom.png"
        alt="自定义截图"
        focus="top"
        fit="contain"
        heightClassName="h-40"
      />,
    );

    const customImage = screen.getByRole('img', { name: '自定义截图' });
    expect(customImage).toHaveAttribute('src', '/custom.png');
    expect(customImage).toHaveClass('object-contain', 'object-top');
    expect(customImage.parentElement).toHaveClass('h-40');
  });
});
