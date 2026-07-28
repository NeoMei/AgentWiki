import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { ProductPage } from './ProductPage';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: null, login: vi.fn() }),
}));

describe('ProductPage workspace intent', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('explains the redirect and focuses email', () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/?intent=workspace#login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ProductPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByText('登录后进入工作台。')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('邮箱')).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用指南' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '工作台' })).toBeInTheDocument();
  });
});
