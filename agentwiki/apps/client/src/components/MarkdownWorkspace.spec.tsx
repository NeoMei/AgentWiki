import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { MarkdownMode, MarkdownWorkspace } from './MarkdownWorkspace';

const Harness = () => {
  const [value, setValue] = useState('# Hello');
  const [mode, setMode] = useState<MarkdownMode>('edit');
  return <MarkdownWorkspace value={value} mode={mode} onChange={(event) => setValue(event.target.value)} onModeChange={setMode} />;
};

describe('MarkdownWorkspace', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it('uses one content surface and switches between edit and preview', () => {
    render(<LanguageProvider><Harness /></LanguageProvider>);

    expect(screen.getByRole('textbox', { name: 'Edit mode' })).toHaveValue('# Hello');
    expect(screen.queryByRole('heading', { name: 'Hello' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('textbox', { name: 'Edit mode' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Edit mode' })).toHaveValue('# Hello');
  });
});
