import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { DocumentPanelToolbar } from './DocumentPanelToolbar';

describe('DocumentPanelToolbar', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));
  it('switches real tools and closes only through the separate collapse action', () => {
    const select = vi.fn(), close = vi.fn();
    render(<LanguageProvider><DocumentPanelToolbar panelIdPrefix="reader" activeTab="notes" open onSelect={select} onClose={close} /></LanguageProvider>);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    const notes = screen.getByRole('tab', { name: 'Page notes' });
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(notes).toHaveAttribute('id', 'reader-tab-notes');
    expect(notes).toHaveAttribute('aria-controls', 'reader-panel-notes');
    fireEvent.click(notes);
    expect(select).toHaveBeenLastCalledWith('notes');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));
    expect(select).toHaveBeenLastCalledWith('contents');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('supports directional wrapping and Home/End while retaining an entry point when collapsed', () => {
    const select = vi.fn();
    render(<LanguageProvider><DocumentPanelToolbar activeTab="contents" open={false} onSelect={select} onClose={vi.fn()} /></LanguageProvider>);
    const contents = screen.getByRole('tab', { name: 'Contents' });
    expect(contents).toHaveAttribute('tabindex', '0');
    expect(contents).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: 'Collapse side panel' })).toBeDisabled();
    fireEvent.keyDown(contents, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Page notes' })).toHaveFocus();
    expect(select).toHaveBeenLastCalledWith('notes');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Page notes' }), { key: 'ArrowRight' });
    expect(contents).toHaveFocus();
    fireEvent.keyDown(contents, { key: 'End' });
    expect(select).toHaveBeenLastCalledWith('notes');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Page notes' }), { key: 'Home' });
    expect(contents).toHaveFocus();
  });
  it('names the icons in Chinese', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><DocumentPanelToolbar activeTab="info" open onSelect={vi.fn()} onClose={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('tab', { name: '页面信息' })).toHaveAttribute('title', '页面信息');
    expect(screen.getByRole('tab', { name: '页面笔记' })).toBeVisible();
  });
  it('skips unavailable tools during keyboard navigation and keeps a reachable enabled tab', () => {
    const select = vi.fn();
    render(<LanguageProvider><DocumentPanelToolbar activeTab="notes" open={false} disabledTabs={['assist', 'notes']} onSelect={select} onClose={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('tab', { name: 'Page notes' })).toBeDisabled();
    const contents = screen.getByRole('tab', { name: 'Contents' });
    expect(contents).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(contents, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Page information' })).toHaveFocus();
    expect(select).toHaveBeenLastCalledWith('info');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Page information' }), { key: 'ArrowRight' });
    expect(contents).toHaveFocus();
  });
});
