import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { Login } from './Login';
import { Register } from './Register';

vi.mock('../../api/client', () => ({ default: { post: vi.fn() } }));
vi.mock('../../context', () => ({ useAuth: () => ({ login: vi.fn() }) }));

const show = (form: 'login' | 'register') => render(<MemoryRouter><LanguageProvider>
  {form === 'login' ? <Login /> : <Register />}
</LanguageProvider></MemoryRouter>);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('authentication field validation', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.setItem('agentwiki.language.v1', 'en'); });

  it('uses custom login errors in field order and focuses the invalid field', () => {
    const { container } = show('login');
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
    submit('Sign in');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email address.');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    fill('Email', 'bad-address');
    submit('Sign in');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    fill('Email', 'user@example.com');
    submit('Sign in');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('uses one custom registration error at a time in name, email, password order', () => {
    const { container } = show('register');
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
    submit('Register');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fill('Name', 'Alice');
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email address.');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    fill('Email', 'invalid');
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    fill('Email', 'alice@example.com');
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    fill('Password', 'short');
    submit('Register');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['a@b..com', 'a@-b.com', 'a@b_.com', 'a@b-.com', 'a@b.123', 'a,b@example.com', 'a<b@example.com', 'a..b@example.com', '.a@example.com', 'a.@example.com'])('rejects malformed email before sending a login request: %s', email => {
    show('login'); fill('Email', email); fill('Password', 'Password1'); submit('Sign in');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['   ', '\t', '\u3000'])('rejects whitespace-only registration names and passwords (%j)', (whitespace) => {
    show('register');
    fill('Name', whitespace); fill('Email', 'alice@example.com'); fill('Password', 'Password1');
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name.');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fill('Name', 'Alice'); fill('Password', whitespace);
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('preserves the registration whitespace policy for otherwise valid credentials', () => {
    show('register');
    fill('Name', 'Alice Smith'); fill('Email', 'alice@example.com'); fill('Password', 'Password1');
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Name cannot contain whitespace.');
    fill('Name', 'Alice'); fill('Password', 'Password 1');
    submit('Register');
    expect(screen.getByRole('alert')).toHaveTextContent('Password cannot contain whitespace.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['login', 'register'] as const)('submits valid %s credentials with normalized email', async (form) => {
    vi.mocked(api.post).mockResolvedValue({ data: { access_token: 'token', user: { id: 'alice' } } });
    show(form);
    if (form === 'register') fill('Name', 'Alice');
    fill('Email', ' alice@example.com '); fill('Password', 'Password1');
    submit(form === 'login' ? 'Sign in' : 'Register');
    expect(api.post).toHaveBeenCalledWith(`/auth/${form}`, {
      email: 'alice@example.com', password: 'Password1', ...(form === 'register' ? { name: 'Alice' } : {}),
    });
  });
});
