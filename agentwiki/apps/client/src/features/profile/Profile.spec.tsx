import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { Profile } from './Profile';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../api/client', () => ({ default: apiMock }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Test User', email: 'user@example.com' },
    login: vi.fn(),
  }),
}));

describe('Profile shortcuts', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    apiMock.get.mockResolvedValue({
      data: { name: 'Test User', email: 'user@example.com', apiKeys: [] },
    });
  });

  it('keeps the Obsidian shortcut pointed at the dedicated guide page', async () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByRole('link', { name: '连接 Obsidian →' }))
      .toHaveAttribute('href', '/guide/obsidian');
  });
});
