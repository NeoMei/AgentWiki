import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { GlobalNavigation } from './GlobalNavigation';

const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: authState.token }),
}));

const renderNavigation = (path: string) => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={[path]}>
      <GlobalNavigation />
    </MemoryRouter>
  </LanguageProvider>,
);

describe('GlobalNavigation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    authState.token = null;
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('shows one Usage Guide destination without a standalone Obsidian entry', () => {
    renderNavigation('/guide');

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('href', '/guide');
    expect(screen.queryByRole('link', { name: '连接 Obsidian' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/?intent=workspace#login');
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Usage Guide active on the Obsidian guide page', () => {
    renderNavigation('/guide/obsidian');

    expect(screen.queryByRole('link', { name: '连接 Obsidian' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends signed-in users directly to the workspace', () => {
    authState.token = 'token';
    renderNavigation('/dashboard');

    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps workspace active while a signed-out user is shown the login intent', () => {
    renderNavigation('/?intent=workspace#login');

    expect(screen.getByRole('link', { name: '首页' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
  });
});
