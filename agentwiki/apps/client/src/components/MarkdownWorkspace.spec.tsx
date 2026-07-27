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

describe('MarkdownWorkspace live-preview editing', () => {
  afterEach(cleanup);
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it('renders the whole document as preview by default, with no add-block button', () => {
    renderWYS();
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/add a block|添加一个块/i)).not.toBeInTheDocument();
  });

  it('clicking an element edits only that element in place; others stay rendered', () => {
    renderWYS();
    fireEvent.click(screen.getByText('First paragraph.'));
    const editors = screen.getAllByRole('textbox');
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveValue('First paragraph.');
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  it('clicking a heading edits its markdown source in place', () => {
    renderWYS();
    fireEvent.click(screen.getByRole('heading', { name: 'Title' }));
    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue('# Title');
  });

  it('editing updates the document and leaving the element restores preview', () => {
    const onChange = vi.fn();
    renderWYS({ onChange });
    fireEvent.click(screen.getByText('First paragraph.'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'First paragraph edited.' } });
    expect(onChange).toHaveBeenLastCalledWith('# Title\n\nFirst paragraph edited.\n\nSecond paragraph.');
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('First paragraph edited.')).toBeInTheDocument();
  });

  it('blurring the element editor exits back to preview', () => {
    renderWYS();
    fireEvent.click(screen.getByText('Second paragraph.'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Second updated.' } });
    fireEvent.blur(editor);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Second updated.')).toBeInTheDocument();
  });

  it('clicking empty space below the content appends a new editable element', () => {
    const onChange = vi.fn();
    renderWYS({ onChange });
    fireEvent.click(screen.getByTestId('md-editor-surface'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Appended line.' } });
    expect(onChange).toHaveBeenLastCalledWith('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nAppended line.');
  });

  it('preview mode renders read-only and elements are not editable', () => {
    renderWYS();
    fireEvent.click(screen.getByRole('button', { name: /Preview|预览/ }));
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('First paragraph.'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('mode switch is a single toggle button', () => {
    renderWYS();
    const toggle = screen.getByRole('button', { name: /Preview|Edit|预览|编辑/ });
    expect(toggle).toHaveAttribute('aria-pressed');
  });
});
