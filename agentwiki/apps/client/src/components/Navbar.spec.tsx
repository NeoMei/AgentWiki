import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Navbar } from './Navbar';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token', user: { email: 'user@example.com' }, logout: vi.fn() }),
}));

vi.mock('../api/client', () => ({
  default: apiMock,
}));

describe('Navbar global destinations', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    apiMock.get.mockResolvedValue({ data: [] });
  });

  it('shows top-level routes and removes their menu duplicates', () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Navbar />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '智能体' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审核' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '个人菜单' }));
    expect(screen.queryAllByRole('link', { name: '使用指南' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: '关于' })).not.toBeInTheDocument();
  });
});
