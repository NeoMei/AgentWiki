import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { PersonalNotesPanel } from './PersonalNotesPanel';
import { captureAssistTarget } from './assistTargets';
import { addPersonalNote } from './reviewComments';
const scope = { userId: 'u', spaceId: 's', pageId: 'p' };
const target = captureAssistTarget('quote', 'selection', 0, 5, '2026-10-06T00:00:00Z')!;
afterEach(cleanup);
describe('personal notes UI', () => {
  it('labels local privacy, adds a selected passage note, and only sends chosen pending notes', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const onAdd = vi.fn(), onDispatch = vi.fn(); const note = addPersonalNote(scope, target, 'Explain it', 'id');
    render(<LanguageProvider><PersonalNotesPanel source="quote" target={target} notes={[note]} onAdd={onAdd} onDispatch={onDispatch} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByText(/Private.*this browser/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'More context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' })); expect(onAdd).toHaveBeenCalledWith(target, 'More context');
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Explain it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' })); expect(onDispatch).toHaveBeenCalledWith(['id']);
  });
  it('keeps orphan quote visible and disables its dispatch, with Chinese labels', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><PersonalNotesPanel source="changed" notes={[addPersonalNote(scope, target, 'Explain', 'id')]} onAdd={() => {}} onDispatch={() => {}} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByText('quote')).toBeInTheDocument(); expect(screen.getByText('原文已变动或定位不唯一')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Explain' })).toBeDisabled();
  });
});
