import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { Login } from './Login';

vi.mock('../../api/client', () => ({ default: { post: vi.fn() } }));
vi.mock('../../context', () => ({ useAuth: () => ({ login: vi.fn() }) }));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('renders a localized invalid-credential response', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 401, data: {
      code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials',
    } } });
    render(<MemoryRouter><LanguageProvider><Login /></LanguageProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'u@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
    expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
  });
});
