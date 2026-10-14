import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { FolderDeletionNotice } from './FolderDeletionNotice';

beforeEach(() => { vi.useFakeTimers(); localStorage.setItem('agentwiki.language.v1', 'en'); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
const onRestore = vi.fn(), onDismiss = vi.fn();
const notice = (restoring = false, name = 'A very long folder name') => <LanguageProvider><FolderDeletionNotice name={name} restoring={restoring} onRestore={onRestore} onDismiss={onDismiss} /></LanguageProvider>;
it('removes the success banner after ten seconds while keeping a usable recovery receipt', () => {
  onRestore.mockClear(); render(notice());
  act(() => vi.advanceTimersByTime(9999)); expect(screen.getByRole('status')).toBeVisible();
  act(() => vi.advanceTimersByTime(1)); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restore recently deleted folder' })); expect(onRestore).toHaveBeenCalledOnce();
});
it('pauses expiry while the restore button has focus and while a restore is pending', () => {
  const view = render(notice());
  const button = screen.getByTestId('folder-restore-button');
  fireEvent.focus(button); act(() => vi.advanceTimersByTime(30000)); expect(screen.getByRole('status')).toBeVisible();
  fireEvent.blur(button, { relatedTarget: document.body });
  view.rerender(notice(true)); act(() => vi.advanceTimersByTime(30000)); expect(screen.getByRole('status')).toBeVisible(); expect(button).toBeDisabled();
  view.rerender(notice(false)); act(() => vi.advanceTimersByTime(10000)); expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('pauses expiry while hovered and gives a new deletion its own ten second notice', () => {
  const view = render(notice());
  fireEvent.mouseEnter(screen.getByTestId('folder-restored-banner')); act(() => vi.advanceTimersByTime(30000)); expect(screen.getByRole('status')).toBeVisible();
  fireEvent.mouseLeave(screen.getByTestId('folder-restored-banner')); act(() => vi.advanceTimersByTime(10000)); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  view.rerender(<LanguageProvider><FolderDeletionNotice key="new-batch" name="Next folder" restoring={false} onRestore={onRestore} onDismiss={onDismiss} /></LanguageProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Next folder');
});
it('allows dismissing the notice first and deliberately removing the recovery receipt afterward', () => {
  onDismiss.mockClear(); render(notice());
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(onDismiss).not.toHaveBeenCalled();
  expect(screen.getByTestId('folder-restore-recovery')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(onDismiss).toHaveBeenCalledOnce();
});
