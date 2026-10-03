import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Toast } from './Toast';

const kinds = ['success', 'error'] as const;

describe('Toast', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it('allows manual dismissal of a fixed error toast', () => {
    const close = vi.fn();
    render(<LanguageProvider><Toast kind="error" message="发布失败" onClose={close} /></LanguageProvider>);
    expect(screen.getByRole('alert')).toHaveClass('fixed');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(kinds)('dismisses %s exactly once after three seconds', (kind) => {
    const close = vi.fn();
    render(<LanguageProvider><Toast kind={kind} message="提示" onClose={close} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(2999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(10000));
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(kinds)('uses latest callback without restarting %s timer', (kind) => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<LanguageProvider><Toast kind={kind} message="提示" onClose={first} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(2000));
    view.rerender(<LanguageProvider><Toast kind={kind} message="提示" onClose={latest} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(999));
    expect(first).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });
  it.each(kinds)('resets %s timer when message changes', (kind) => {
    const close = vi.fn();
    const view = render(<LanguageProvider><Toast kind={kind} message="第一条" onClose={close} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(2000));
    view.rerender(<LanguageProvider><Toast kind={kind} message="第二条" onClose={close} /></LanguageProvider>);
    expect(screen.getByText('第二条')).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(kinds)('resets timer when kind changes from %s', (kind) => {
    const close = vi.fn();
    const next = kind === 'success' ? 'error' : 'success';
    const view = render(<LanguageProvider><Toast kind={kind} message="提示" onClose={close} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(2000));
    view.rerender(<LanguageProvider><Toast kind={next} message="提示" onClose={close} /></LanguageProvider>);
    expect(screen.getByRole(next === 'error' ? 'alert' : 'status')).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1999));
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(kinds)('cancels %s timer on unmount', (kind) => {
    const close = vi.fn();
    const view = render(<LanguageProvider><Toast kind={kind} message="提示" onClose={close} /></LanguageProvider>);
    act(() => vi.advanceTimersByTime(2000));
    view.unmount();
    act(() => vi.advanceTimersByTime(10000));
    expect(close).not.toHaveBeenCalled();
  });
});
