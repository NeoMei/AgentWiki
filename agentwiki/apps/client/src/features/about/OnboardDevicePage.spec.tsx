import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { OnboardDevicePage } from './OnboardDevicePage';

const authState: { token: string | null } = { token: 'human-token' };

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const session = {
  clientType: 'codex',
  purpose: 'full-onboarding',
  packageVersion: '0.3.1',
  status: 'pending',
  expiresAt: '2099-08-10T12:30:00.000Z',
};

const renderPage = (entry = '/onboard/device?user_code=ABCD-EFGH') => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={[entry]}>
      <OnboardDevicePage />
    </MemoryRouter>
  </LanguageProvider>,
);

describe('OnboardDevicePage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    authState.token = 'human-token';
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: session });
  });

  it('rejects a missing or malformed code without making a request', () => {
    const { rerender } = renderPage('/onboard/device');
    expect(screen.getByText('授权链接无效')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();

    rerender(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/onboard/device?user_code=unsafe']}>
          <OnboardDevicePage />
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the public session context without rendering secrets', async () => {
    renderPage();

    expect(await screen.findByText('Codex')).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(screen.getByText('完整 Agent 接入')).toBeInTheDocument();
    expect(screen.getByText('0.3.1')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ABCD-EFGH');
    expect(document.body.textContent).not.toContain('awo_');
    expect(localStorage.length).toBe(1);
    expect(api.get).toHaveBeenCalledWith('/onboard/device/session', {
      params: { userCode: 'ABCD-EFGH' },
    });
  });

  it('preserves a safe return target for a signed-out user', async () => {
    authState.token = null;
    renderPage();

    expect(await screen.findByText('Codex')).toBeInTheDocument();
    const signIn = screen.getByRole('link', { name: '登录或注册后授权' });
    expect(signIn).toHaveAttribute(
      'href',
      '/?intent=onboard&returnTo=%2Fonboard%2Fdevice%3Fuser_code%3DABCD-EFGH#login',
    );
    expect(screen.queryByRole('button', { name: '允许接入' })).not.toBeInTheDocument();
  });

  it('approves once and disables both decisions while the request is in flight', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as any);
    renderPage();
    await screen.findByText('Codex');

    fireEvent.click(screen.getByRole('button', { name: '允许接入' }));
    expect(screen.getByRole('button', { name: '授权中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '授权中…' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/onboard/device/decision', {
      userCode: 'ABCD-EFGH',
      decision: 'approve',
    });

    finish({ data: { status: 'approved' } });
    expect(await screen.findByText('已允许此 Agent 接入')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '允许接入' })).not.toBeInTheDocument();
  });

  it('denies once and ends in a terminal message', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'denied' } });
    renderPage();
    await screen.findByText('Codex');

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(await screen.findByText('已拒绝此接入请求')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/onboard/device/decision', {
      userCode: 'ABCD-EFGH',
      decision: 'deny',
    });
  });

  it.each([
    ['expired', '授权请求已过期'],
    ['denied', '此接入请求已被拒绝'],
    ['approved', '此接入请求已完成决定'],
    ['authorized', '此接入请求已完成决定'],
  ])('shows a terminal state for %s', async (status, expected) => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...session, status } });
    renderPage();
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '允许接入' })).not.toBeInTheDocument();
  });

  it.each(['zh-CN','en'] as const)('explains Obsidian authorization and plugin return in %s',async language=>{
    localStorage.setItem('agentwiki.language.v1',language);
    vi.mocked(api.get).mockResolvedValue({data:{...session,clientType:'obsidian',purpose:'obsidian-connect'}});
    vi.mocked(api.post).mockResolvedValue({data:{status:'approved'}});
    renderPage();
    expect(await screen.findByRole('heading',{name:language==='zh-CN'?'连接 Obsidian':'Connect Obsidian'})).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('扫描计划');
    fireEvent.click(screen.getByRole('button',{name:language==='zh-CN'?'允许接入':'Authorize connection'}));
    expect(await screen.findByText(language==='zh-CN'?'已授权，请回到 Obsidian 完成连接':'Authorized. Return to Obsidian to finish connecting')).toBeInTheDocument();
  });

  it.each(['zh-CN','en'] as const)('keeps legacy and bounded Agent purposes distinct in %s', async language => {
    localStorage.setItem('agentwiki.language.v1',language);
    const zh = language === 'zh-CN';
    const legacy = renderPage();
    expect(await screen.findByText(zh ? '完整 Agent 接入' : 'Full Agent onboarding')).toBeInTheDocument();
    expect(screen.getByText(zh ? /确认 Agent、Space、权限和扫描计划/ : /confirm the Agent, Space, permissions, and scan plan/)).toBeInTheDocument();
    expect(screen.queryByText(zh ? /知识导入可以稍后进行/ : /Knowledge import can wait/)).not.toBeInTheDocument();
    legacy.unmount();
    vi.mocked(api.get).mockResolvedValue({data:{...session,purpose:'agent-connect'}});
    renderPage();
    expect(await screen.findByText(zh ? 'Agent 连接' : 'Agent connection')).toBeInTheDocument();
    expect(screen.getByText(zh ? /知识导入可以稍后进行/ : /Knowledge import can wait/)).toBeInTheDocument();
  });
  it.each(['zh-CN','en'] as const)('does not promise legacy same-session renewal in %s', async language => {
    localStorage.setItem('agentwiki.language.v1',language);
    vi.mocked(api.get).mockResolvedValue({data:{...session,status:'expired'}});
    renderPage();
    expect(await screen.findByText(language === 'zh-CN' ? '授权请求已过期' : 'The authorization request has expired')).toBeInTheDocument();
    expect(screen.getByText(language === 'zh-CN' ? /按原接入流程重新获取授权链接/ : /original onboarding flow for a fresh authorization link/)).toBeInTheDocument();
    expect(screen.queryByText(/continue the same session|继续原会话/)).not.toBeInTheDocument();
  });

  it('expires an old pending request and gives purpose-specific retry guidance',async()=>{
    vi.mocked(api.get).mockResolvedValue({data:{...session,clientType:'obsidian',purpose:'obsidian-connect',expiresAt:new Date(Date.now()-1).toISOString()}});
    renderPage();
    expect(await screen.findByText('授权请求已过期')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'允许接入'})).not.toBeInTheDocument();
    expect(screen.getByText('请回到 Obsidian，重新点击“连接 AgentWiki”。')).toBeInTheDocument();
  });

  it('ignores a delayed decision when navigating to another authorization request',async()=>{
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockReturnValue(new Promise(resolve=>{finish=resolve;}) as any);
    const NextRequest=()=>{const navigate=useNavigate();return <button onClick={()=>navigate('/onboard/device?user_code=JKLM-NPQR')}>Next request</button>;};
    render(<LanguageProvider><MemoryRouter initialEntries={['/onboard/device?user_code=ABCD-EFGH']}><OnboardDevicePage/><NextRequest/></MemoryRouter></LanguageProvider>);
    await screen.findByText('Codex');
    fireEvent.click(screen.getByRole('button',{name:'允许接入'}));
    fireEvent.click(screen.getByRole('button',{name:'Next request'}));
    await screen.findByRole('button',{name:'允许接入'});
    finish({data:{status:'approved'}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'允许接入'})).toBeEnabled());
    expect(screen.queryByText('已允许此 Agent 接入')).not.toBeInTheDocument();
  });

  it('rejects mismatched purpose/client contracts instead of presenting approval',async()=>{
    vi.mocked(api.get).mockResolvedValue({data:{...session,clientType:'obsidian',purpose:'agent-connect'}});
    renderPage();
    expect(await screen.findByText('授权链接无效或已失效')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'允许接入'})).not.toBeInTheDocument();
  });

  it('shows an invalid-link state when the session lookup fails', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { data: { code: 'RESOURCE_NOT_FOUND' } } });
    renderPage();
    await waitFor(() => expect(screen.getByText('授权链接无效或已失效')).toBeInTheDocument());
  });
});
