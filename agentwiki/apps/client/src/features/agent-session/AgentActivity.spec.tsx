import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentActivity } from './AgentActivity';

beforeEach(() => { localStorage.setItem('agentwiki.language.v1', 'en'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T10:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Agent execution activity', () => {
  it('continues elapsed time across phases and releases its timer when the turn finishes or unmounts', () => {
    const view = render(<LanguageProvider><AgentActivity status="queued" createdAt="2026-10-15T09:59:57Z" /></LanguageProvider>);
    expect(screen.getByText('3s elapsed')).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('5s elapsed')).toBeVisible();
    view.rerender(<LanguageProvider><AgentActivity status="running" progress={{ phase: 'generating' }} createdAt="2026-10-15T09:59:57Z" /></LanguageProvider>);
    expect(screen.getByText('5s elapsed')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Generating response');
    expect(screen.getByRole('status')).not.toHaveTextContent('elapsed');
    expect(vi.getTimerCount()).toBe(1);
    view.rerender(<LanguageProvider><p>Done</p></LanguageProvider>);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<LanguageProvider><AgentActivity status="sending" /></LanguageProvider>);
    expect(vi.getTimerCount()).toBe(1); view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('uses local time for an invalid date and never displays negative duration', () => {
    const view = render(<LanguageProvider><AgentActivity status="running" createdAt="invalid" /></LanguageProvider>);
    expect(screen.getByText('0s elapsed')).toBeVisible(); view.unmount();
    render(<LanguageProvider><AgentActivity status="running" createdAt="2099-01-01" /></LanguageProvider>);
    expect(screen.getByText('0s elapsed')).toBeVisible();
  });
  it('localizes stages and retries without trusting a queued turn as already executing', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const view = render(<LanguageProvider><AgentActivity status="running" progress={{ phase: 'preparing', attempt: 2 }} /></LanguageProvider>);
    expect(screen.getByRole('status', { name: 'Agent 执行状态' })).toHaveTextContent('正在准备上下文');
    expect(screen.getByText('正在重试 · 第 2 次尝试')).toBeVisible();
    view.rerender(<LanguageProvider><AgentActivity status="queued" progress={{ phase: 'finalizing', attempt: 2 }} /></LanguageProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('正在排队等待执行');
    expect(screen.queryByText('正在整理结果')).not.toBeInTheDocument();
    expect(screen.queryByText('正在重试 · 第 2 次尝试')).not.toBeInTheDocument();
  });
});
