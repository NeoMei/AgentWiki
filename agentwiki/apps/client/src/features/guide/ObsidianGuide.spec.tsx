import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../context/LanguageContext';
import { ObsidianGuide } from './ObsidianGuide';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'signed-in' }) }));
vi.mock('../../api/client', () => ({ default: apiMock }));

describe('ObsidianGuide availability', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    apiMock.get.mockResolvedValue({ data: { credentials: [] } });
    apiMock.post.mockResolvedValue({
      data: { code: 'AW-TEST-CODE', expiresAt: new Date(Date.now() + 600_000).toISOString() },
    });
  });

  it('leads with the published community-market installation and keeps GitHub as a fallback', () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);
    expect(screen.getByText('在第三方插件市场安装')).toBeInTheDocument();
    expect(screen.getAllByText(/搜索 AgentWiki Sync/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '在 Obsidian 中打开' })).toHaveAttribute(
      'href', 'obsidian://show-plugin?id=agentwiki-sync',
    );
    expect(screen.getByRole('link', { name: '下载最新 Release' })).toHaveAttribute(
      'href', 'https://github.com/NeoMei/agentwiki-sync/releases/latest',
    );
  });

  it('leads with plugin-initiated connection and a nearby manual fallback',()=>{
    const {container}=render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);
    expect(screen.getByRole('heading',{name:'连接 Obsidian'})).toBeInTheDocument();
    expect(screen.getByText('在插件设置中点击“连接 AgentWiki”')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'使用手动连接码'})).toHaveAttribute('href','#connect');
    expect(container.querySelector('#connect')).toBeInTheDocument();
  });

  it('keeps installation, code generation, and device management on the same page', async () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('button', { name: '生成连接码' })).toBeInTheDocument();
    expect(screen.getByText('已连接设备')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '打开集成管理' })).not.toBeInTheDocument();
  });

  it('disables an expired manual code and offers regeneration',async()=>{
    apiMock.post.mockResolvedValueOnce({data:{code:'EXPIRED-CODE',expiresAt:new Date(Date.now()-1).toISOString()}});
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'生成连接码'}));
    expect(await screen.findByText('连接码已过期，请重新生成。')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'复制'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'重新生成连接码'}));
    expect(await screen.findByText('AW-TEST-CODE')).toBeInTheDocument();
  });

  it.each(['zh-CN','en'] as const)('keeps the generated code usable after clipboard failure in %s', async language => {
    const zh = language === 'zh-CN';
    localStorage.setItem('agentwiki.language.v1',language);
    Object.assign(navigator,{clipboard:{writeText:vi.fn().mockRejectedValue(new Error('clipboard denied'))}});
    render(<MemoryRouter><LanguageProvider><ObsidianGuide/></LanguageProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:zh?'生成连接码':'Generate Connection Code'}));
    expect(await screen.findByText('AW-TEST-CODE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:zh?'复制':'Copy'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(zh?'请手动选择并复制上方连接码':'Select and copy the visible connection code manually');
    expect(screen.getByText('AW-TEST-CODE')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:zh?'复制':'Copy'})).toBeEnabled();
  });

  it('shows the server origin required by the Obsidian plugin after generating a code', async () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '生成连接码' }));

    expect(await screen.findByText(`2. 服务器地址：${window.location.origin}`)).toBeInTheDocument();
  });
});
