import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { OnboardDevicePage } from './OnboardDevicePage';
import { ProductPage } from './ProductPage';

const login = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: null, login }),
}));

vi.mock('../../api/client', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
};

const registrationForm = (language: 'zh-CN' | 'en' = 'zh-CN') => {
  localStorage.setItem('agentwiki.language.v1', language);
  const zh = language === 'zh-CN';
  render(<LanguageProvider><MemoryRouter><ProductPage /></MemoryRouter></LanguageProvider>);
  fireEvent.click(screen.getByRole('tab', { name: zh ? '切换到注册' : 'Switch to register' }));
  fireEvent.change(screen.getByLabelText(zh ? '名称' : 'Name'), { target: { value: 'Tester' } });
  fireEvent.change(screen.getByLabelText(zh ? '邮箱' : 'Email'), { target: { value: 'tester@example.com' } });
  fireEvent.change(screen.getByLabelText(zh ? '密码' : 'Password'), { target: { value: 'Password1' } });
  return {
    email: screen.getByLabelText(zh ? '邮箱' : 'Email'),
    submit: screen.getByRole('button', { name: zh ? '注册' : 'Register' }),
  };
};

describe('ProductPage workspace intent', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    Element.prototype.scrollIntoView = vi.fn();
    login.mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('explains the redirect and focuses email', () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=workspace#login']}>
          <ProductPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByText('登录后进入工作台。')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('邮箱')).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: '使用指南' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '邮箱' })).toHaveFocus();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '切换到登录' })).toHaveAttribute('aria-selected', 'true');
  });

  it('associates registration validation with the password field', async () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=workspace#login']}>
          <ProductPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: '切换到注册' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Neo' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'neo@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    const password = screen.getByLabelText('密码');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription('密码至少需要 8 个字符');
  });

  it('implements keyboard navigation and panel association for the auth tabs', () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/']}>
          <ProductPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const loginTab = screen.getByRole('tab', { name: '切换到登录' });
    const registerTab = screen.getByRole('tab', { name: '切换到注册' });
    loginTab.focus();
    fireEvent.keyDown(loginTab, { key: 'ArrowRight' });

    expect(registerTab).toHaveFocus();
    expect(registerTab).toHaveAttribute('aria-selected', 'true');
    expect(registerTab).toHaveAttribute('tabindex', '0');
    expect(loginTab).toHaveAttribute('tabindex', '-1');
    expect(registerTab).toHaveAttribute('aria-controls', 'product-auth-panel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'product-auth-tab-register');

    fireEvent.keyDown(registerTab, { key: 'Home' });
    expect(loginTab).toHaveFocus();
    expect(loginTab).toHaveAttribute('aria-selected', 'true');
  });

  it.each(['login', 'register'] as const)('returns to device authorization after %s', async (mode) => {
    vi.mocked(api.post).mockResolvedValue({
      data: { access_token: 'human-token', user: { id: 'user-1' } },
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=onboard&returnTo=%2Fonboard%2Fdevice%3Fuser_code%3DABCD-EFGH#login']}>
          <Routes>
            <Route path="/" element={<ProductPage />} />
            <Route path="/onboard/device" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByText('登录或注册后返回连接授权页面。')).toBeInTheDocument();
    if (mode === 'register') {
      fireEvent.click(screen.getByRole('tab', { name: '切换到注册' }));
      fireEvent.change(screen.getByPlaceholderText('名称'), { target: { value: 'Neo' } });
    }
    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'neo@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: mode === 'login' ? '登录' : '注册' }));

    await waitFor(() => expect(screen.getByText('/onboard/device?user_code=ABCD-EFGH')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith(
      mode === 'login' ? '/auth/login' : '/auth/register',
      mode === 'login'
        ? { email: 'neo@example.com', password: 'Password1' }
        : { email: 'neo@example.com', password: 'Password1', name: 'Neo' },
    );
  });

  it.each([['zh-CN','login'],['zh-CN','register'],['en','login'],['en','register']] as const)('preserves Obsidian device context through %s %s', async (language, mode) => {
    const zh = language === 'zh-CN';
    localStorage.setItem('agentwiki.language.v1',language);
    vi.mocked(api.get).mockResolvedValue({data:{clientType:'obsidian',purpose:'obsidian-connect',packageVersion:'0.4.0',status:'pending',expiresAt:'2099-01-01T00:00:00Z'}});
    vi.mocked(api.post).mockResolvedValue({data:{access_token:'human-token',user:{id:'user-1'}}});
    render(<LanguageProvider><MemoryRouter initialEntries={['/onboard/device?user_code=ABCD-EFGH']}><Routes>
      <Route path="/" element={<ProductPage/>}/>
      <Route path="/onboard/device" element={<><OnboardDevicePage/><LocationProbe/></>}/>
    </Routes></MemoryRouter></LanguageProvider>);
    fireEvent.click(await screen.findByRole('link',{name:zh?'登录或注册后授权':'Sign in or register to authorize'}));
    expect(screen.getByRole('status')).toHaveTextContent(zh?'登录或注册后返回连接授权页面。':'Sign in or register to return to connection authorization.');
    if(mode === 'register') {
      fireEvent.click(screen.getByRole('tab',{name:zh?'切换到注册':'Switch to register'}));
      fireEvent.change(screen.getByPlaceholderText(zh?'名称':'Name'),{target:{value:'Fixture'}});
    }
    fireEvent.change(screen.getByPlaceholderText(zh?'邮箱':'Email'),{target:{value:'fixture@example.invalid'}});
    fireEvent.change(screen.getByPlaceholderText(zh?'密码':'Password'),{target:{value:'Password1'}});
    fireEvent.click(screen.getByRole('button',{name:zh?(mode==='login'?'登录':'注册'):(mode==='login'?'Sign in':'Register')}));
    expect(await screen.findByRole('heading',{name:zh?'连接 Obsidian':'Connect Obsidian'})).toBeInTheDocument();
    expect(screen.getByText('/onboard/device?user_code=ABCD-EFGH')).toBeInTheDocument();
  });

  it('ignores an unsafe return target after login', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { access_token: 'human-token', user: { id: 'user-1' } },
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=onboard&returnTo=https%3A%2F%2Fevil.example#login']}>
          <Routes>
            <Route path="/" element={<ProductPage />} />
            <Route path="/dashboard" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'neo@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByText('/dashboard')).toBeInTheDocument());
  });

  it('localizes authentication errors on the actual landing-page login form', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 401, data: {
      code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials',
    } } });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=workspace#login']}>
          <ProductPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'wrong@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
    expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
  });

  it.each(['zh-CN', 'en'] as const)('explains duplicate email and preserves it when switching to login in %s', async (language) => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'AUTH_EMAIL_IN_USE' } } });
    const { email, submit } = registrationForm(language);
    fireEvent.click(submit);
    const expected = language === 'zh-CN' ? '该邮箱已注册，请登录。' : 'This email is already registered. Please sign in.';
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(expect.stringContaining(expected));
    expect(email).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: language === 'zh-CN' ? '去登录' : 'Go to sign in' }));
    expect(screen.getByRole('tab', { name: language === 'zh-CN' ? '切换到登录' : 'Switch to sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(email).toHaveValue('tester@example.com');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['missing-at', 'tester@example', 'tester@example.', ''])('blocks malformed registration email %s before sending a request', (value) => {
    const { email, submit } = registrationForm();
    fireEvent.change(email, { target: { value } });
    fireEvent.click(submit);
    expect(api.post).not.toHaveBeenCalled();
    expect(email).toHaveAccessibleDescription('请输入有效的邮箱地址，例如 name@example.com。');
    expect(email).toHaveFocus();
    fireEvent.change(email, { target: { value: 'fixed@example.com' } });
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['zh-CN', 'en'] as const)('renders the server email-validation fallback at the field in %s', async (language) => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { code: 'BAD_REQUEST', message: 'email must be an email' } } });
    const { email, submit } = registrationForm(language);
    fireEvent.click(submit);
    const expected = language === 'zh-CN' ? '请输入有效的邮箱地址，例如 name@example.com。' : 'Enter a valid email address, such as name@example.com.';
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(email).toHaveAccessibleDescription(expected);
    expect(screen.queryByText('email must be an email')).not.toBeInTheDocument();
  });

  it('handles the deployed legacy duplicate-email response', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'RESOURCE_CONFLICT', message: 'Email already in use' } } });
    const { submit } = registrationForm();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('该邮箱已注册，请登录。');
  });

  it.each([
    [400, 'BAD_REQUEST', 'name must be a string', '注册失败'],
    [409, 'RESOURCE_CONFLICT', 'Other conflict', '该项目与已有资源冲突'],
    [429, 'AUTH_RATE_LIMITED', 'Too many requests', '请求过于频繁'],
  ])('retains the shared fallback for non-email errors %s / %s', async (status, code, message, expected) => {
    vi.mocked(api.post).mockRejectedValue({ response: { status, data: { code, message } } });
    const { email, submit } = registrationForm();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(email).toHaveAttribute('aria-invalid', 'false');
  });
});
