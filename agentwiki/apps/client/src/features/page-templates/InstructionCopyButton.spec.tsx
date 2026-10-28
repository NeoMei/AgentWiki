import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { InstructionCopyButton } from './InstructionCopyButton';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}
const button = (text = 'Run run-1. Join as agent-1.') => <LanguageProvider><InstructionCopyButton text={text} /></LanguageProvider>;

describe('InstructionCopyButton', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    clipboard(async () => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the complete instruction, waits for success, and restores the action after feedback', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    let copiedText = '';
    clipboard(text => { copiedText = text; return new Promise<void>(resolve => { complete = resolve; }); });
    render(button('Run run-1.\nCall wiki_collaboration_join_run with agent-1.'));
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(screen.getByRole('button', { name: '复制中…' })).toBeDisabled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(copiedText).toBe('Run run-1.\nCall wiki_collaboration_join_run with agent-1.');
    await act(async () => complete());
    expect(screen.getByRole('button', { name: '已复制' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('加入指令已复制');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('button', { name: '复制' })).toBeEnabled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it.each(['denied', 'unavailable'])('reports a %s clipboard and allows a retry without claiming success', async failure => {
    if (failure === 'denied') clipboard(async () => { throw new Error('clipboard denied'); });
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(button());
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请手动选择并复制上方指令');
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument();
    clipboard(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps feedback local to the instruction that was copied', async () => {
    render(<LanguageProvider><section aria-label="Alpha"><InstructionCopyButton text="Alpha instruction" /></section><section aria-label="Beta"><InstructionCopyButton text="Beta instruction" /></section></LanguageProvider>);
    fireEvent.click(within(screen.getByRole('region', { name: 'Alpha' })).getByRole('button', { name: '复制' }));
    expect(await within(screen.getByRole('region', { name: 'Alpha' })).findByRole('button', { name: '已复制' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Beta' })).getByRole('button', { name: '复制' })).toBeEnabled();
  });

  it('ignores a stale completion after the instruction changes', async () => {
    let complete!: () => void;
    clipboard(() => new Promise<void>(resolve => { complete = resolve; }));
    const view = render(button('Old instruction'));
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    view.rerender(button('New instruction'));
    await act(async () => complete());
    expect(screen.getByRole('button', { name: '复制' })).toBeEnabled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('uses the persisted English locale for success and failure feedback', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = render(button());
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
    view.rerender(button('Different instruction'));
    clipboard(async () => { throw new Error('denied'); });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select and copy the instruction above');
  });
});
