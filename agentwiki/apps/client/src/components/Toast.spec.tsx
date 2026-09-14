import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Toast } from './Toast';

describe('Toast', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('keeps an error toast fixed in the current viewport and closes it', () => {
    const onClose = vi.fn();
    render(<LanguageProvider><Toast kind="error" message="发布失败" onClose={onClose} /></LanguageProvider>);
    expect(screen.getByRole('alert')).toHaveClass('fixed');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

 describe('Toast lifetime', () => {
   afterEach(() => vi.useRealTimers());
   it('dismisses success on time despite inline callback rerenders, using the latest callback', () => {
     vi.useFakeTimers();
     const first = vi.fn(); const latest = vi.fn();
     const view = render(<LanguageProvider><Toast kind="success" message="Copied" onClose={first} /></LanguageProvider>);
     act(() => vi.advanceTimersByTime(2000));
     view.rerender(<LanguageProvider><Toast kind="success" message="Copied" onClose={latest} /></LanguageProvider>);
     act(() => vi.advanceTimersByTime(1000));
     expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
   });
   it('keeps errors available and cancels timers on unmount or message replacement', () => {
     vi.useFakeTimers(); const close = vi.fn();
     const view = render(<LanguageProvider><Toast kind="success" message="Copied" onClose={close} /></LanguageProvider>);
     act(() => vi.advanceTimersByTime(2000));
     view.rerender(<LanguageProvider><Toast kind="error" message="Failed" onClose={close} /></LanguageProvider>);
     act(() => vi.advanceTimersByTime(10000));
     expect(screen.getByRole('alert')).toBeVisible(); expect(close).not.toHaveBeenCalled();
     view.rerender(<LanguageProvider><Toast kind="success" message="Done" onClose={close} /></LanguageProvider>);
     view.unmount(); act(() => vi.advanceTimersByTime(10000)); expect(close).not.toHaveBeenCalled();
   });
 });
