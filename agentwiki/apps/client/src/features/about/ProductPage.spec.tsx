import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { ProductPage } from './ProductPage';

const login = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: null, login }),
}));

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
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

    expect(screen.getByText('登录或注册后返回 Agent 授权页面。')).toBeInTheDocument();
    if (mode === 'register') {
      fireEvent.click(screen.getByRole('button', { name: '切换到注册' }));
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
});
