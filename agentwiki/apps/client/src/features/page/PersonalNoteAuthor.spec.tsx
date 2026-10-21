import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalNoteAuthor } from './PersonalNoteAuthor';
import { PersonalNotesPanel } from './PersonalNotesPanel';
import { LanguageProvider } from '../../context/LanguageContext';
import { addPersonalNote } from './reviewComments';
import { captureAssistTarget } from './assistTargets';

const auth = vi.hoisted(() => ({ user: null as { id: string; name?: string; email?: string } | null }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
afterEach(() => { cleanup(); auth.user = null; });

describe('personal note author identity', () => {
  it('labels each panel card by its stored owner rather than the viewer', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    auth.user = { id: 'alice-id', name: 'Alice' };
    const target = captureAssistTarget('quote', 'selection', 0, 5, '2026-10-14T00:00:00Z')!;
    const notes = ['alice-id', 'bob-id'].map((userId) => addPersonalNote({ userId, spaceId: 's', pageId: 'p' }, target, `${userId} note`, userId));
    render(<LanguageProvider><PersonalNotesPanel source="quote" notes={notes} onDispatch={() => {}} onResolve={() => {}} onReopen={() => {}} /></LanguageProvider>);
    const aliceCard = screen.getByRole('checkbox', { name: 'alice-id note' }).closest('li')!;
    const bobCard = screen.getByRole('checkbox', { name: 'bob-id note' }).closest('li')!;
    expect(within(aliceCard).getByLabelText('Note author: Alice (you)')).toBeVisible();
    expect(within(bobCard).getByLabelText('Note author: User bob-id')).toBeVisible();
    expect(within(bobCard).queryByText(/Alice/)).not.toBeInTheDocument();
  });

  it('does not attribute an existing note to a different signed-in account after rerender', () => {
    auth.user = { id: 'alice-id', name: 'Alice', email: 'alice@example.test' };
    const view = render(<PersonalNoteAuthor userId="alice-id" language="en" />);
    expect(screen.getByLabelText('Note author: Alice (you)')).toBeVisible();
    auth.user = { id: 'bob-id', name: 'Bob', email: 'bob@example.test' };
    view.rerender(<PersonalNoteAuthor userId="alice-id" language="en" />);
    expect(screen.getByLabelText('Note author: User alice-id')).toBeVisible();
    expect(screen.queryByText(/Alice|Bob/)).not.toBeInTheDocument();
    view.rerender(<PersonalNoteAuthor userId="bob-id" language="en" />);
    expect(screen.getByLabelText('Note author: Bob (you)')).toBeVisible();
  });

  it('never labels an unknown author as the current user', () => {
    auth.user = { id: 'alice-id', name: 'Alice' };
    const view = render(<PersonalNoteAuthor language="zh-CN" />);
    expect(screen.getByLabelText('笔记作者: 未知用户')).toBeVisible();
    expect(screen.queryByText(/Alice|我/)).not.toBeInTheDocument();
    view.rerender(<PersonalNoteAuthor userId=" " language="zh-CN" />);
    expect(screen.getByLabelText('笔记作者: 未知用户')).toBeVisible();
    view.rerender(<PersonalNoteAuthor userId="other-id" language="zh-CN" />);
    expect(screen.getByLabelText('笔记作者: 用户 other-id')).toBeVisible();
  });

  it('uses email or self label only for the exact account and handles logout', () => {
    auth.user = { id: 'alice-id', name: ' ', email: 'alice@example.test' };
    const view = render(<PersonalNoteAuthor userId="alice-id" language="zh-CN" />);
    expect(screen.getByLabelText('笔记作者: alice@example.test (我)')).toBeVisible();
    auth.user = { id: 'alice-id' };
    view.rerender(<PersonalNoteAuthor userId="alice-id" language="zh-CN" />);
    expect(screen.getByLabelText('笔记作者: 我')).toBeVisible();
    auth.user = null;
    view.rerender(<PersonalNoteAuthor userId="alice-id" language="zh-CN" />);
    expect(screen.getByLabelText('笔记作者: 用户 alice-id')).toBeVisible();
  });
});


it('uses server author names and an Agent badge without confusing a matching Agent id with the viewer', () => {
  auth.user = { id: 'same-id', name: 'Human' };
  const name = 'Research Agent with a deliberately long descriptive name';
  const view = render(<PersonalNoteAuthor language="en" author={{ type: 'agent', id: 'same-id', name }} />);
  expect(screen.getByLabelText(`Note author: ${name}`)).toBeVisible();
  expect(screen.getByText('Agent')).toBeVisible(); expect(screen.queryByText(/you|Human/)).not.toBeInTheDocument();
  expect(screen.getByTitle(name)).toBeInTheDocument();
  view.rerender(<PersonalNoteAuthor language="en" author={{ type: 'user', id: 'bob', name: 'Bob from server' }} />);
  expect(screen.getByLabelText('Note author: Bob from server')).toBeVisible();
});
