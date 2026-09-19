import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('automatically closes notifications after their visibility window', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<LanguageProvider><Toast kind="success" message="已保存" onClose={onClose} /></LanguageProvider>);
    vi.advanceTimersByTime(3999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
