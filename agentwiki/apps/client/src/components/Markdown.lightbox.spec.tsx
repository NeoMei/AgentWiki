import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Markdown } from './Markdown';
beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));
it('opens accepted image in a dialog and restores its trigger after Escape and backdrop close', async () => {
  render(<LanguageProvider><MemoryRouter><Markdown>{'![Architecture](https://example.com/diagram.png)'}</Markdown></MemoryRouter></LanguageProvider>);
  const opener = screen.getByRole('button', { name: 'Enlarge image: Architecture' });
  opener.focus(); fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Image preview' });
  expect(dialog.querySelector('img')).toHaveAttribute('src', 'https://example.com/diagram.png');
  expect(dialog.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(opener).toHaveFocus());
  fireEvent.click(opener); fireEvent.click(screen.getByRole('dialog').parentElement!);
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
