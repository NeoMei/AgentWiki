import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { ModeToggleButton } from './ModeToggleButton';

describe('ModeToggleButton', () => {
  afterEach(cleanup);
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it('shows a pen in edit mode (action: switch to preview)', () => {
    render(<LanguageProvider><ModeToggleButton mode="edit" onToggle={() => {}} /></LanguageProvider>);
    expect(screen.getByTestId('mode-toggle')).toHaveAttribute('aria-label', 'Preview');
    expect(screen.getByTestId('mode-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a book in preview mode (action: switch to edit)', () => {
    render(<LanguageProvider><ModeToggleButton mode="preview" onToggle={() => {}} /></LanguageProvider>);
    expect(screen.getByTestId('mode-toggle')).toHaveAttribute('aria-label', 'Edit');
    expect(screen.getByTestId('mode-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  it('fires onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<LanguageProvider><ModeToggleButton mode="edit" onToggle={onToggle} /></LanguageProvider>);
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
