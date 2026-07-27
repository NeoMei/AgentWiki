import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { MarkdownMode, MarkdownWorkspace } from './MarkdownWorkspace';

const Harness = ({ initial = '# Title\n\nFirst paragraph.\n\nSecond paragraph.', onChange = () => {} }: any) => {
  const [value, setValue] = useState(initial);
  const [mode, setMode] = useState<MarkdownMode>('edit');
  return (
    <MarkdownWorkspace
      value={value}
      mode={mode}
      onChange={(next: string) => { setValue(next); onChange(next); }}
      onModeChange={setMode}
    />
  );
};

const renderWYS = (props?: any) => render(<LanguageProvider><Harness {...props} /></LanguageProvider>);

describe('MarkdownWorkspace WYSIWYG', () => {
  afterEach(cleanup);
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it('edit mode renders all blocks as preview by default, not a raw textarea', () => {
    renderWYS();
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('clicking a block turns only that block into an editor; others stay rendered', () => {
    renderWYS();
    fireEvent.click(screen.getByTestId('md-block-1'));
    const editors = screen.getAllByRole('textbox');
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveValue('First paragraph.');
    // other blocks still rendered as preview
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  it('editing a block updates the full markdown and exit restores preview', () => {
    const onChange = vi.fn();
    renderWYS({ onChange });
    fireEvent.click(screen.getByTestId('md-block-1'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'First paragraph edited.' } });
    expect(onChange).toHaveBeenLastCalledWith('# Title\n\nFirst paragraph edited.\n\nSecond paragraph.');
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('First paragraph edited.')).toBeInTheDocument();
  });

  it('blurring the block editor exits back to preview', () => {
    renderWYS();
    fireEvent.click(screen.getByTestId('md-block-2'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Second updated.' } });
    fireEvent.blur(editor);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Second updated.')).toBeInTheDocument();
  });

  it('preview mode renders everything read-only and blocks are not editable', () => {
    renderWYS();
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('md-block-1'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('mode switch is a single toggle button, not two tabs', () => {
    renderWYS();
    const toggle = screen.getByRole('button', { name: /Preview|Edit/ });
    expect(toggle).toHaveAttribute('aria-pressed');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Edit|Preview/ })).toBeInTheDocument();
  });
});
