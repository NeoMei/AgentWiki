import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { AgentSessionRegistryProvider } from './AgentSessionRegistry';
import { AgentSessionPanel } from './AgentSessionPanel';
import type { AgentSessionPanelProps, AgentTurn } from './agentSessionTypes';
import { captureAssistTarget } from '../page/assistTargets';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
const auth = vi.hoisted(() => ({ id: 'user-a' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: auth }) }));
const version = '2026-10-06T01:00:00.000Z';
const summary = { id: 'session-a', spaceId: 'space-a', title: 'Conversation A', createdAt: version, updatedAt: version };
const turn: AgentTurn = { id: 'turn-a', sessionId: summary.id, pageId: 'page-a', mode: 'question', intent: 'Earlier question', status: 'done', createdAt: version, pageSnapshot: { title: 'Original A', content: 'Original source', updatedAt: version }, references: [{ pageId: 'ref-a', title: 'Original reference', updatedAt: version }], noteIds: [], progressText: '', result: { summary: 'Earlier answer' }, error: null };
const defaults: AgentSessionPanelProps = { pageId: 'page-a', spaceId: 'space-a', pageTitle: 'Page A', snapshot: () => ({ title: 'Page A', content: 'unsaved current draft', updatedAt: version, draftRevision: 1, remoteRevision: 0 }), canEdit: true, canAccept: true };
function tree(props: Partial<AgentSessionPanelProps> = {}, user = auth.id) { return <MemoryRouter><AgentSessionRegistryProvider userId={user}><AgentSessionPanel {...defaults} {...props} /></AgentSessionRegistryProvider></MemoryRouter>; }
function selectConversation(id: string) {
  const title = id === 'session-a' ? 'Conversation A' : id === 'session-b' ? 'Conversation B' : 'Lost source';
  fireEvent.click(screen.getByRole('tab', { name: title }));
}
function scopeControl() {
  const summary = document.querySelector<HTMLElement>('[aria-label="Context settings"]')!;
  if (!summary.closest('details')?.open) fireEvent.click(summary);
  return screen.getByRole('combobox', { name: 'Edit scope' });
}
function openStaged() {
  const details = document.querySelector<HTMLDetailsElement>('.agent-staged-context');
  if (details && !details.open) fireEvent.click(details.querySelector('summary')!);
}
function openCandidate() {
  const details = document.querySelector<HTMLDetailsElement>('.agent-candidate-details');
  if (details && !details.open) fireEvent.click(details.querySelector('summary')!);
}
let turns: AgentTurn[];
beforeEach(() => {
  localStorage.clear(); auth.id = 'user-a'; turns = [turn];
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary] : url === '/assist/sessions/session-a' ? { ...summary, turns } : { results: [{ page: { id: 'page-b', title: 'Reference B', spaceId: 'space-a' } }] } }));
  vi.mocked(api.post).mockImplementation(async (url, data: any) => url === '/assist/sessions' ? { data: { ...summary, id: 'session-new', title: 'New conversation' } } : { data: { ...turn, ...data, id: 'turn-new', sessionId: summary.id, status: 'queued', pageSnapshot: data.snapshot, references: [], result: null } });
});
afterEach(cleanup);
describe('directory conversations', () => {
  it('does not auto-open a running conversation from another directory', async () => {
    turns = [{ ...turn, status: 'running' }];
    render(tree({ pageId: null, pageTitle: 'Research B', snapshot: undefined, directory: { folderId: 'folder-b' }, canEdit: false }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    expect(screen.queryByRole('tab', { name: 'Conversation A' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Read only Research B' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/assist/sessions', { spaceId: 'space-a' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/assist/sessions/session-new/turns', expect.objectContaining({ directory: { folderId: 'folder-b', recursive: true } })));
  });

  it('labels unavailable directory content without claiming an empty directory was read', async () => {
    turns = [{ ...turn, directory: { folderId: 'folder-a', title: 'Research', recursive: true, pageCount: 0, unavailableReason: 'Directory exceeds the document limit' } } as AgentTurn];
    render(tree());
    await screen.findByText('Earlier answer');
    expect(screen.getByText(/Directory content was not loaded/)).toBeVisible();
    expect(screen.queryByText(/Research · 0 pages/)).not.toBeInTheDocument();
  });

  it.each([null, 'folder-a'])('sends a recursive question from directory %s without a page snapshot', async (folderId) => {
    render(tree({ pageId: null, pageTitle: 'Research', snapshot: undefined, directory: { folderId }, canEdit: false, canAccept: false }));
    await screen.findByText('Start a conversation about this directory.');
    expect(screen.queryByRole('combobox', { name: 'Message mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Edit scope' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Summarize every page in this directory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls.find(([url]) => url.endsWith('/turns'))![1] as any;
    expect(payload).toMatchObject({ pageId: null, mode: 'auto', directory: { folderId, recursive: true } });
    expect(payload).not.toHaveProperty('snapshot');
    expect(payload).not.toHaveProperty('annotations');
  });

  it('keeps unsent directory drafts isolated from the root and from document edit mode', async () => {
    const rendered = render(tree());
    await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Document edit' } });
    rendered.rerender(tree({ pageId: null, pageTitle: 'Research', snapshot: undefined, directory: { folderId: 'folder-a' }, canEdit: false }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Research question' } });
    rendered.rerender(tree({ pageId: null, pageTitle: 'Root', snapshot: undefined, directory: { folderId: null }, canEdit: false }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    rendered.rerender(tree({ pageId: null, pageTitle: 'Research', snapshot: undefined, directory: { folderId: 'folder-a' }, canEdit: false }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Research question'));
  });

  it('shows the resolved directory and page count while document sends keep their current draft', async () => {
    turns = [{ ...turn, directory: { folderId: 'folder-a', title: 'Research', recursive: true, pageCount: 8 } }];
    render(tree());
    await screen.findByText('Earlier answer');
    expect(screen.getByText('Research · 8 pages · including subfolders')).toBeVisible();
    expect(screen.getByText(/current directory and subfolders are available automatically/i)).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Read the current directory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls.find(([url]) => url.endsWith('/turns'))![1] as any;
    expect(payload.pageId).toBe('page-a');
    expect(payload.snapshot.content).toBe('unsaved current draft');
    expect(payload).not.toHaveProperty('directory');
  });

  it('keeps a late directory send in its originating scope after navigation to the root', async () => {
    let finish!: (value: { data: AgentTurn }) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const rendered = render(tree({ pageId: null, pageTitle: 'Research', snapshot: undefined, directory: { folderId: 'folder-a' }, canEdit: false }));
    await screen.findByText('Start a conversation about this directory.');
    fireEvent.click(document.querySelector<HTMLElement>('[aria-label="Conversation history"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation A' }));
    await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Read research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    rendered.rerender(tree({ pageId: null, pageTitle: 'Root', snapshot: undefined, directory: { folderId: null }, canEdit: false }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'New root question' } });
    await act(async () => finish({ data: { ...turn, id: 'late-directory', pageId: null, pageSnapshot: null, intent: 'Read research', directory: { folderId: 'folder-a', title: 'Research', recursive: true, pageCount: 8 }, result: { summary: 'Late Research answer' } } }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('New root question');
    expect(screen.queryByText('Late Research answer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
describe('closable conversation tabs', () => {
  const summaries = [summary, ...['b', 'c', 'd'].map((id) => ({ ...summary, id: `session-${id}`, title: `Conversation ${id.toUpperCase()}` }))];
  const mockHistory = () => vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? summaries : { ...summaries.find((item) => url.endsWith(item.id)), turns: url.endsWith(summary.id) ? turns : [] } }));
  const close = (title: string) => fireEvent.click(screen.getByRole('button', { name: `Close ${title}` }));
  const reopen = (title: string) => {
    fireEvent.click(document.querySelector<HTMLElement>('[aria-label="Conversation history"]')!);
    fireEvent.click(screen.getByRole('button', { name: title }));
  };

  it('closes a background tab without selecting it or filling its place from history', async () => {
    mockHistory(); render(tree()); await screen.findByText('Earlier answer');
    close('Conversation B');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Conversation A', 'Conversation C']);
    expect(screen.getByRole('tab', { name: 'Conversation A' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Earlier answer')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('scrolls the selected tab together with its sibling close button into view', async () => {
    mockHistory();
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent === 'Conversation B' ? 100 : 0; });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('agent-conversation-tab-item') ? 169 : this.getAttribute('role') === 'tab' ? 142 : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'tablist' ? 250 : 0; });
    render(tree()); await screen.findByText('Earlier answer');
    selectConversation('session-b');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    // The title button ends at 242; the close button extends the whole tab to 269.
    expect(screen.getByRole('tablist').scrollLeft).toBe(19);
  });

  it('keeps the selected close button visible after the tab strip narrows and cleans up its observer', async () => {
    mockHistory(); let stripWidth = 300;
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class {
      private elements: Element[] = [];
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { this.elements.push(element); callbacks.set(element, this.callback); }
      disconnect() { this.elements.forEach((element) => callbacks.delete(element)); }
    });
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent === 'Conversation B' ? 100 : 0; });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('agent-conversation-tab-item') ? 169 : this.getAttribute('role') === 'tab' ? 142 : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'tablist' ? stripWidth : 0; });
    try {
      const rendered = render(tree()); await screen.findByText('Earlier answer'); selectConversation('session-b');
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
      const tabs = screen.getByRole('tablist'); expect(tabs.scrollLeft).toBe(0);
      stripWidth = 240; act(() => callbacks.get(tabs)?.([], {} as ResizeObserver));
      expect(tabs.scrollLeft).toBe(29);
      rendered.unmount(); expect(callbacks.has(tabs)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it('closes the selected tab with Delete and focuses its right neighbour, then its left neighbour', async () => {
    mockHistory(); render(tree({ autoFocus: false })); await screen.findByText('Earlier answer');
    const first = screen.getByRole('tab', { name: 'Conversation A' });
    first.focus(); fireEvent.keyDown(first, { key: 'Delete' });
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Conversation A' })).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Conversation B' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversation B' })).toHaveFocus();
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation C' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    const lastClose = screen.getByRole('button', { name: 'Close Conversation C' });
    lastClose.focus(); fireEvent.click(lastClose);
    expect(screen.getByRole('tab', { name: 'Conversation B' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversation B' })).toHaveFocus();
  });

  it('closes the last tab to an empty composer without deleting history or sending a request', async () => {
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep private draft' } });
    const closeButton = screen.getByRole('button', { name: 'Close Conversation A' });
    closeButton.focus(); fireEvent.click(closeButton);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'New conversation' })).toHaveFocus();
    reopen('Conversation A'); await screen.findByText('Earlier answer');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep private draft');
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!)).join('')).not.toContain('Keep private draft');
  });

  it('opens new and historical sessions once without evicting other open tabs', async () => {
    mockHistory(); render(tree()); await screen.findByText('Earlier answer');
    reopen('Conversation D');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    reopen('Conversation D');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await screen.findByRole('tab', { name: 'New conversation' });
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tab', { name: 'New conversation' })).toHaveAttribute('aria-selected', 'true');
  });

  it.each([false, true])('keeps explicitly closed tabs closed after %s all tabs close and panel remount / full reload', async (allClosed) => {
    mockHistory();
    const shell = (show: boolean) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{show ? <AgentSessionPanel {...defaults} /> : null}</AgentSessionRegistryProvider></MemoryRouter>;
    const first = render(shell(true)); await screen.findByText('Earlier answer');
    close('Conversation B'); close('Conversation C');
    if (allClosed) close('Conversation A');
    first.rerender(shell(false)); first.rerender(shell(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled());
    expect(screen.queryAllByRole('tab').map((tab) => tab.textContent)).toEqual(allClosed ? [] : ['Conversation A']);
    first.unmount(); render(tree());
    await waitFor(() => expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled());
    expect(screen.queryAllByRole('tab').map((tab) => tab.textContent)).toEqual(allClosed ? [] : ['Conversation A']);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps tab preferences isolated between accounts and Spaces', async () => {
    vi.mocked(api.get).mockImplementation(async (url, config: any) => {
      const scoped = { ...summary, spaceId: url === '/assist/sessions' ? config.params.spaceId : 'space-a' };
      return { data: url === '/assist/sessions' ? [scoped] : { ...scoped, turns } };
    });
    const first = render(tree()); await screen.findByText('Earlier answer'); close('Conversation A'); first.unmount();
    auth.id = 'user-b'; const otherUser = render(tree({}, 'user-b')); await screen.findByText('Earlier answer');
    expect(screen.getByRole('tab', { name: 'Conversation A' })).toBeVisible(); otherUser.unmount();
    auth.id = 'user-a'; const otherSpace = render(tree({ spaceId: 'space-b' }));
    expect(await screen.findByRole('tab', { name: 'Conversation A' })).toBeVisible(); otherSpace.unmount();
    render(tree()); await waitFor(() => expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled());
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('disables close while Send is pending and lets a running task continue after close and history reopen', async () => {
    let resolveSend!: (response: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }) as any);
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Run this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Close Conversation A' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Conversation A' }), { key: 'Delete' });
    expect(screen.getByRole('tab', { name: 'Conversation A' })).toBeInTheDocument();
    turns = [{ ...turn, status: 'running', result: null }];
    await act(async () => resolveSend({ data: turns[0] }));
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
    close('Conversation A');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    turns = [{ ...turn, result: { summary: 'Completed while closed' } }];
    reopen('Conversation A'); expect(await screen.findByText('Completed while closed')).toBeVisible();
    expect(vi.mocked(api.post).mock.calls.map(([url]) => url)).toEqual(['/assist/sessions/session-a/turns']);
  });

  it('does not reopen a closed tab when its detail read arrives late', async () => {
    let resolveRead!: (response: any) => void;
    vi.mocked(api.get).mockImplementation((url) => url === '/assist/sessions' ? Promise.resolve({ data: [summary] }) : new Promise((resolve) => { resolveRead = resolve; }) as any);
    render(tree({ autoFocus: false })); await screen.findByRole('tab', { name: 'Conversation A' });
    close('Conversation A');
    await act(async () => resolveRead({ data: { ...summary, turns } }));
    expect(screen.queryByRole('tab')).not.toBeInTheDocument(); expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  });

  it('waits for the initial history list before allowing restored tabs to close', async () => {
    const first = render(tree()); await screen.findByText('Earlier answer'); first.unmount();
    let resolveList!: (response: any) => void;
    vi.mocked(api.get).mockImplementation((url) => url === '/assist/sessions'
      ? new Promise((resolve) => { resolveList = resolve; }) as any
      : Promise.resolve({ data: { ...summary, turns } }));
    render(tree());
    const restoredClose = screen.getByRole('button', { name: /^Close / });
    expect(restoredClose).toBeDisabled(); fireEvent.click(restoredClose);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    await act(async () => resolveList({ data: [summary] }));
    await screen.findByText('Earlier answer'); close('Conversation A');
    reopen('Conversation A'); expect(await screen.findByText('Earlier answer')).toBeVisible();
  });

  it('waits for explicit new-session creation before closing or switching the existing tab', async () => {
    let resolveCreate!: (response: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }) as any);
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('button', { name: 'Close Conversation A' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Conversation A' })).toBeDisabled();
    close('Conversation A');
    await act(async () => resolveCreate({ data: { ...summary, id: 'session-new', title: 'New conversation' } }));
    expect(screen.getByRole('tab', { name: 'New conversation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Close Conversation A' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'Conversation A' })).toBeInTheDocument();
  });

  it('does not restore an already sent empty-state draft after closing the implicitly created session', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockImplementation(async (url, data: any) => url === '/assist/sessions'
      ? { data: { ...summary, id: 'session-new', title: 'New conversation' } }
      : { data: { ...turn, ...data, sessionId: 'session-new', result: { summary: 'Answered' } } });
    render(tree());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Send this once' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Answered');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    close('New conversation');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('recovers an open older session directly when it falls outside the history list after reload', async () => {
    mockHistory(); const first = render(tree()); await screen.findByText('Earlier answer'); reopen('Conversation D');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled()); first.unmount();
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((url, ...args) => url === '/assist/sessions' ? Promise.resolve({ data: summaries.slice(0, 3) }) : get(url, ...args));
    render(tree());
    expect(await screen.findByRole('tab', { name: 'Conversation D' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('falls back safely when stored tab preferences are malformed', async () => {
    const first = render(tree()); await screen.findByText('Earlier answer'); close('Conversation A'); first.unmount();
    expect(localStorage.length).toBe(1); localStorage.setItem(localStorage.key(0)!, '{bad json');
    render(tree()); expect(await screen.findByText('Earlier answer')).toBeVisible();
  });

  it('keeps closed state in memory when browser storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => { if (key === 'token') return null; throw new Error('Storage unavailable'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    try {
      const shell = (show: boolean) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{show ? <AgentSessionPanel {...defaults} /> : null}</AgentSessionRegistryProvider></MemoryRouter>;
      const rendered = render(shell(true)); await screen.findByText('Earlier answer'); close('Conversation A');
      rendered.rerender(shell(false)); rendered.rerender(shell(true));
      await waitFor(() => expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled());
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    } finally { getItem.mockRestore(); setItem.mockRestore(); }
  });
});
describe('durable Agent session document bridge', () => {
  it('sends automatic messages without a mode selector and reports a server-saved document once', async () => {
    const onDocumentWritten = vi.fn();
    const document = { operation: 'updated', pageId: 'page-a', title: 'Page A', updatedAt: '2026-10-06T02:00:00.000Z', url: '/pages/page-a' };
    vi.mocked(api.post).mockImplementation(async (_url, data: any) => {
      const completed = { ...turn, ...data, id: 'auto-turn', mode: 'auto', status: 'done', pageSnapshot: data.snapshot, references: [], result: { action: 'update', summary: 'Updated', changes: 'Changed source', document } } as AgentTurn;
      turns = [...turns, completed];
      return { data: completed };
    });
    const rendered = render(tree({ onDocumentWritten } as any));
    await screen.findByText('Earlier answer');
    expect(screen.queryByRole('combobox', { name: 'Message mode' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Rewrite this page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onDocumentWritten).toHaveBeenCalledWith(document, expect.objectContaining({ content: 'unsaved current draft', draftRevision: 1 })));
    expect(vi.mocked(api.post).mock.calls.slice(-1)[0]?.[1]).toMatchObject({ mode: 'auto' });
    expect(screen.getByText('Document updated and saved.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Page A' })).toHaveAttribute('href', '/pages/page-a');
    expect(screen.queryByText('Accept to draft')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    rendered.rerender(tree({ onDocumentWritten } as any));
    expect(onDocumentWritten).toHaveBeenCalledTimes(1);
  });

  it('shows historical saved receipts without refreshing or rewriting their documents', async () => {
    const onDocumentWritten = vi.fn();
    turns = [{ ...turn, mode: 'auto', result: { action: 'create', summary: 'Created', document: { operation: 'created', pageId: 'new-page', title: 'New document', updatedAt: version, url: '/pages/new-page' } } } as AgentTurn];
    render(tree({ onDocumentWritten } as any));
    await screen.findByText('Created');
    expect(screen.getByText('Document created and saved.')).toBeVisible();
    expect(onDocumentWritten).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('does not refresh a different page when an automatic completion arrives after navigation', async () => {
    let complete!: (value: { data: AgentTurn }) => void;
    const onDocumentWritten = vi.fn();
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const rendered = render(tree({ onDocumentWritten }));
    await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Rewrite this page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls[0][1] as any;
    rendered.rerender(tree({ pageId: 'page-b', onDocumentWritten }));
    await act(async () => complete({ data: { ...turn, id: 'late-written', mode: 'auto', status: 'done', pageSnapshot: payload.snapshot, result: { action: 'update', summary: 'Saved on A', document: { operation: 'updated', pageId: 'page-a', title: 'Page A', updatedAt: version, url: '/pages/page-a' } } } }));
    expect(onDocumentWritten).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('keeps an automatic answer in chat without refreshing or writing the page', async () => {
    const onDocumentWritten = vi.fn();
    vi.mocked(api.post).mockImplementation(async (_url, data: any) => ({ data: { ...turn, ...data, id: 'answer-turn', sessionId: summary.id, mode: 'auto', status: 'done', pageSnapshot: data.snapshot, references: [], result: { action: 'answer', summary: 'Here is the explanation.' } } }));
    render(tree({ onDocumentWritten }));
    await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain this page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Here is the explanation.');
    expect(onDocumentWritten).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.queryByText('Document updated and saved.')).not.toBeInTheDocument();
  });
  it('keeps ordinary tab focus and honors each explicit composer focus request once', async () => {
    const rendered = render(tree({ autoFocus: false }));
    await screen.findByText('Earlier answer');
    const message = screen.getByRole('textbox', { name: 'Message' });
    const references = screen.getByRole('button', { name: 'Reference pages' });
    expect(message).not.toHaveFocus();
    rendered.rerender(tree({ autoFocus: false, focusRequest: 'shortcut-1' }));
    expect(message).toHaveFocus();
    references.focus();
    rendered.rerender(tree({ autoFocus: false, focusRequest: 'shortcut-1' }));
    expect(references).toHaveFocus();
    rendered.rerender(tree({ autoFocus: false, focusRequest: 'shortcut-2' }));
    expect(message).toHaveFocus();
  });
  it.each([false, true])('waits for a requested composer load and cancels it when hidden=%s', async (hide) => {
    let release!: (value: { data: typeof summary[] }) => void;
    const load = new Promise<{ data: typeof summary[] }>((resolve) => { release = resolve; });
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((url, ...args) => url === '/assist/sessions' ? load : get(url, ...args));
    const rendered = render(tree({ autoFocus: false, focusRequest: 'shortcut-1' }));
    const message = screen.getByRole('textbox', { name: 'Message' });
    expect(message).toBeDisabled(); expect(message).not.toHaveFocus();
    if (hide) rendered.rerender(tree({ autoFocus: false, focusRequest: 'shortcut-1', visible: false }));
    await act(async () => release({ data: [summary] }));
    await screen.findByText('Earlier answer');
    if (hide) {
      expect(message).not.toHaveFocus();
      rendered.rerender(tree({ autoFocus: false, focusRequest: 'shortcut-1', visible: true }));
      expect(message).not.toHaveFocus();
    } else expect(message).toHaveFocus();
  });
  it('does not steal focus while hidden and preserves the composer between panel switches', async () => {
    const rendered = render(tree({ visible: false }));
    await screen.findByText('Earlier answer');
    const message = screen.getByRole('textbox', { name: 'Message' });
    expect(message).not.toHaveFocus();
    rendered.rerender(tree({ visible: true }));
    expect(message).toHaveFocus();
    fireEvent.change(message, { target: { value: 'Unsent panel draft' } });
    const references = screen.getByRole('button', { name: 'Reference pages' });
    references.focus();
    rendered.rerender(tree({ visible: false }));
    expect(references).toHaveFocus();
    rendered.rerender(tree({ visible: true }));
    expect(message).toHaveValue('Unsent panel draft');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('keeps history across pages/read mode and explicitly sends current draft plus selected references', async () => {
    const applyToWrongPage = vi.fn(); const rendered = render(tree());
    expect(await screen.findByText('Earlier answer')).toBeVisible();
    rendered.rerender(tree({ pageId: 'page-b', pageTitle: 'Page B', canAccept: false, onApply: applyToWrongPage }));
    expect(screen.getByText('Earlier answer')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reference pages' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Find reference pages' }), { target: { value: 'Reference' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Reference B' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const sent = vi.mocked(api.post).mock.calls.find(([url]) => url.endsWith('/turns'))?.[1] as any;
    expect(sent.referencePageIds).toEqual(['page-b']); expect(sent.snapshot.content).toBe('unsaved current draft'); expect(sent.pageId).toBe('page-b');
    expect(applyToWrongPage).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
    fireEvent.click(screen.getAllByText('Sources and versions at send')[0]);
    expect(screen.getByText('Original A')).toBeVisible(); expect(screen.getByText('Original reference')).toBeVisible();
  });
  it('retains failed send intent and references, shows recovery, and supports a fresh empty conversation', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep my message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/retry/i);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep my message');
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument());
    expect(screen.getByText('Start a conversation about this document.')).toBeVisible();
  });
  it('allows reader questions, stages immutable page notes until explicit Send and never resolves on response', async () => {
    const onNotesEvent = vi.fn(), onRequestHandled = vi.fn();
    render(tree({ canEdit: false, canAccept: false, assistRequest: { id: 'req', intent: 'Explain my notes', autoSubmit: true, noteIds: ['note-a'], annotations: [{ id: 'note-a', quote: 'unsaved', body: 'Why?' }] }, onNotesEvent, onRequestHandled }));
    await screen.findByText('Earlier answer');
    expect(api.post).not.toHaveBeenCalled(); expect(screen.queryByRole('combobox', { name: 'Message mode' })).not.toBeInTheDocument();
    openStaged(); expect(screen.getByText('Why?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onRequestHandled).toHaveBeenCalledWith('req'));
    const payload = vi.mocked(api.post).mock.calls[0][1] as any;
    expect(payload.mode).toBe('auto'); expect(payload.annotations).toEqual([{ id: 'note-a', quote: 'unsaved', body: 'Why?' }]);
    expect(onNotesEvent.mock.calls[0][0].event).toBe('dispatch'); expect(onNotesEvent.mock.invocationCallOrder[0]).toBeLessThan(onRequestHandled.mock.invocationCallOrder[0]);
    expect(onNotesEvent.mock.calls.some(([e]) => e.event === 'accept')).toBe(false);
  });
});

it('preserves a staged composer when first session creation succeeds but its first send fails', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockImplementation(async (url) => { if (url === '/assist/sessions') return { data: { ...summary, id: 'new' } }; throw new Error('offline'); });
  render(tree({ assistRequest: { id: 'first-request', intent: 'Keep annotations', noteIds: ['n'], annotations: [{ id: 'n', quote: 'unsaved', body: 'keep note' }] } }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep annotations'); openStaged(); expect(screen.getByText('keep note')).toBeVisible();
});
it('clears an inaccessible historical source on 400 while keeping the unsent composer recoverable', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Still here' } });
  vi.mocked(api.get).mockRejectedValue({ response: { status: 400, data: { message: 'Session page must exist in the selected Space' } } });
  selectConversation('session-a');
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer accessible');
  expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Still here');
});
it('does not send stale failures into a newly selected conversation', async () => {
  let reject!: (error: unknown) => void;
  const delayed = new Promise((_, rejectPromise) => { reject = rejectPromise; });
  vi.mocked(api.post).mockReturnValue(delayed as any);
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
  const rendered = render(tree()); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Delayed' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  // A new document mount is permitted while POST is outstanding, even with the selector disabled.
  rendered.rerender(tree({ spaceId: 'space-b' }));
  await act(async () => reject(new Error('old send')));
  expect(screen.queryByText('Request failed. Your message is preserved. Please retry.')).not.toBeInTheDocument();
});

it('switches sessions without allowing an older fetch to overwrite the selected history', async () => {
  let resolveA!: (value: any) => void;
  const delayed = new Promise((resolve) => { resolveA = resolve; });
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/assist/sessions') return { data: [summary, second] };
    if (url.endsWith('session-a')) return delayed as any;
    return { data: { ...second, turns: [{ ...turn, id: 'turn-b', sessionId: 'session-b', result: { summary: 'Answer B' } }] } };
  });
  render(tree()); await screen.findByRole('tab', { name: 'Conversation B' });
  selectConversation('session-b');
  await screen.findByText('Answer B');
  await act(async () => resolveA({ data: { ...summary, turns: [turn] } }));
  expect(screen.getByText('Answer B')).toBeVisible(); expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
});
it('recovers server history after refresh and clears all visible history on account and Space switches', async () => {
  const first = render(tree()); await screen.findByText('Earlier answer'); first.unmount();
  const restored = render(tree()); expect(await screen.findByText('Earlier answer')).toBeVisible();
  vi.mocked(api.get).mockResolvedValue({ data: [] }); auth.id = 'user-b';
  restored.rerender(tree({}, 'user-b'));
  expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  await screen.findByText('Start a conversation about this document.');
  restored.rerender(tree({ spaceId: 'other-space' }, 'user-b'));
  expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  expect(localStorage.getItem('agent-session')).toBeNull();
});
it('fences cancellation responses after navigating to another Space', async () => {
  turns = [{ ...turn, status: 'running', result: null }];
  let resolveCancel!: (value: any) => void;
  vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolveCancel = resolve; }) as any);
  const rendered = render(tree()); fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  expect(api.post).toHaveBeenCalledWith('/assist/tasks/turn-a/cancel');
  vi.mocked(api.get).mockResolvedValue({ data: [] }); rendered.rerender(tree({ spaceId: 'another' }));
  await act(async () => resolveCancel({ data: { ...turn, status: 'cancelled' } }));
  expect(screen.queryByText('Stopped')).not.toBeInTheDocument(); expect(screen.queryByText('Earlier question')).not.toBeInTheDocument();
});
it('polls real queued/running state and displays only returned progress and answers', async () => {
  turns = [{ ...turn, status: 'running', result: null, progressText: 'Actual answer progress' }];
  render(tree()); await screen.findByText('Actual answer progress');
  turns = [{ ...turn, result: { summary: 'Finished answer' } }];
  expect(await screen.findByText('Finished answer', {}, { timeout: 2000 })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
});
it('never applies a historical candidate to another page and regenerates with its original scope and annotations', async () => {
  const snapshot = { title: 'Page A', content: 'unsaved current draft', updatedAt: version, assistTarget: { kind: 'selection' as const, from: 0, to: 7, quote: 'unsaved', prefix: '', suffix: ' current draft', baseUpdatedAt: version } };
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: snapshot, noteIds: ['n'], annotations: [{ id: 'n', body: 'Explain change', quote: 'unsaved' }], result: { changes: 'changed current draft' } }];
  const onApply = vi.fn(); const rendered = render(tree({ pageId: 'other-page', onApply, supportsScopedApply: true }));
  expect(await screen.findByRole('button', { name: 'Accept to draft' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Accept to draft' })); expect(onApply).not.toHaveBeenCalled();
  rendered.rerender(tree({ onApply, supportsScopedApply: true, snapshot: () => ({ ...snapshot, content: 'different draft', draftRevision: 7 }) }));
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  expect(scopeControl()).toHaveValue('selection'); openStaged(); expect(screen.getByText('Explain change', { selector: '.agent-session-composer p' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); expect(api.post).not.toHaveBeenCalled(); expect(screen.getAllByRole('alert').some((e) => e.textContent?.includes('Selection or version changed'))).toBe(true);
});
it('waits for the current local notes bridge before replaying a historical ready event', async () => {
  turns = [{ ...turn, mode: 'proposal', noteIds: ['note'], result: { changes: 'changed source' } }];
  const onNotesEvent = vi.fn(); const rendered = render(tree({ notesReady: false, onNotesEvent }));
  await screen.findByRole('region', { name: 'Candidate review' });
  expect(onNotesEvent).not.toHaveBeenCalled();
  rendered.rerender(tree({ notesReady: true, onNotesEvent }));
  await waitFor(() => expect(onNotesEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'ready', noteIds: ['note'] })));
});
it('allows stopping a later turn after an old cancellation completes while its Space is unmounted', async () => {
  turns = [{ ...turn, status: 'running', result: null }];
  let resolveCancel!: (value: any) => void;
  vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolveCancel = resolve; }) as any);
  const rendered = render(tree()); fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  const read = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockResolvedValue({ data: [] }); rendered.rerender(tree({ spaceId: 'other' }));
  await act(async () => resolveCancel({ data: { ...turn, status: 'cancelled' } }));
  turns = [{ ...turn, id: 'later-turn', status: 'running', result: null }]; vi.mocked(api.get).mockImplementation(read); rendered.rerender(tree());
  expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
});
it('regenerates a conflicted whole-document proposal from the current source without inventing annotation attachments', async () => {
  const original = 'unsaved current draft';
  const target = { kind: 'document' as const, from: 0, to: original.length, quote: original, prefix: '', suffix: '', baseUpdatedAt: version };
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: { title: 'Page A', content: original, updatedAt: version, assistTarget: target }, references: [], noteIds: [], annotations: [], result: { changes: 'Candidate content' } }];
  const manual = 'Manually changed current draft';
  render(tree({ supportsScopedApply: true, snapshot: () => ({ title: 'Page A', content: manual, updatedAt: version, draftRevision: 4, remoteRevision: 0 }) }));
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  expect(screen.queryByText('These page notes will be included with your message.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  const payload = vi.mocked(api.post).mock.calls[0][1] as any;
  expect(payload.mode).toBe('auto'); expect(payload.snapshot.content).toBe(manual); expect(payload.snapshot.assistTarget).toMatchObject({ kind: 'document', quote: manual, to: manual.length }); expect(payload.annotations).toEqual([]);
});
it('keeps an unsent composer when route remount discovers its selected session was omitted from the accessible list', async () => {
  const shell = (show: boolean) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{show ? <AgentSessionPanel {...defaults} /> : null}</AgentSessionRegistryProvider></MemoryRouter>;
  const rendered = render(shell(true)); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Recover this unsent intent' } });
  rendered.rerender(shell(false));
  vi.mocked(api.get).mockImplementation(async (url) => { if (url === '/assist/sessions') return { data: [] }; throw { response: { status: 400, data: { message: 'Session source is no longer available' } } }; });
  rendered.rerender(shell(true));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer accessible');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Recover this unsent intent'); expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled();
});
it('preserves the no-replay acceptance ledger when another conversation loses source access', async () => {
  const original = 'Original source', originalSnapshot = { title: 'Original A', content: original, updatedAt: version, draftRevision: 0, remoteRevision: 0, assistTarget: { kind: 'document' as const, from: 0, to: original.length, quote: original, prefix: '', suffix: '', baseUpdatedAt: version } };
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: originalSnapshot, result: { changes: 'Changed source' } }];
  const second = { ...summary, id: 'inaccessible', title: 'Lost source' };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/assist/sessions') return { data: [summary, second] };
    if (url.endsWith('/inaccessible')) throw { response: { status: 400, data: { message: 'Session source is no longer available' } } };
    return { data: { ...summary, turns } };
  });
  let content = original;
  render(tree({ supportsScopedApply: true, snapshot: () => ({ ...originalSnapshot, content }), onApply: () => { content = 'Changed source'; return true; } }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept to draft' }));
  openCandidate(); expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
  content = original; // Editor Undo changes source; accepted history must never rewind.
  selectConversation('inaccessible'); await screen.findByRole('alert');
  selectConversation('session-a');
  await screen.findByText('View changes'); openCandidate(); expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
  expect(screen.getByText('Accepted to draft. Save the page to publish these changes.')).toBeVisible();
});

const scopedRoutes = ['remount', 'read/edit', 'page roundtrip', 'session switch'] as const;
it.each(['selection', 'section'] as const)('preserves regenerated %s context through every composer lifetime boundary', async (kind) => {
  for (const boundary of scopedRoutes) {
    cleanup(); vi.mocked(api.post).mockClear();
    const content = '# One\none\n# Two\ntwo\n', target = captureAssistTarget(content, kind, 6, 9, version)!;
    turns = [{ ...turn, mode: 'proposal', status: 'failed', result: null, pageSnapshot: { title: 'Page A', content, updatedAt: version, assistTarget: target } }];
    const second = { ...summary, id: 'session-b', title: 'Conversation B' };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
    const shell = (route = 'edit') => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{route === 'hidden' ? null : <AgentSessionPanel key={route} {...defaults} pageId={route === 'other' ? 'page-b' : 'page-a'} canAccept={route !== 'read'} snapshot={() => ({ title: 'Page A', content, updatedAt: version })} supportsScopedApply />}</AgentSessionRegistryProvider></MemoryRouter>;
    const view = render(shell());
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
    if (boundary === 'session switch') {
      selectConversation('session-b');
      await screen.findByText('Start a conversation about this document.');
      expect(scopeControl()).toHaveValue('document');
      selectConversation('session-a');
    } else {
      view.rerender(shell(boundary === 'remount' ? 'hidden' : boundary === 'read/edit' ? 'read' : 'other'));
      if (boundary !== 'remount') await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
      view.rerender(shell());
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    expect(scopeControl(), boundary).toHaveValue(kind);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((vi.mocked(api.post).mock.calls[0][1] as any).snapshot.assistTarget, boundary).toEqual(target);
  }
});
it.each(['selection', 'section'] as const)('refuses a stale restored %s until explicit reselection, without widening it', async (kind) => {
  const content = '# One\none\n# Two\ntwo\n', target = captureAssistTarget(content, kind, 6, 9, version)!;
  turns = [{ ...turn, mode: 'proposal', status: 'failed', result: null, pageSnapshot: { title: 'Page A', content, updatedAt: version, assistTarget: target } }];
  const changed = '# One\nnew\n# Two\ntwo\n', currentTarget = captureAssistTarget(changed, kind, 6, 9, version)!;
  const shell = (route: string) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{route === 'hidden' ? null : <AgentSessionPanel key={route} {...defaults} snapshot={() => ({ title: 'Page A', content: route === 'original' ? content : changed, updatedAt: version })} assistTargets={{ [kind]: currentTarget }} supportsScopedApply />}</AgentSessionRegistryProvider></MemoryRouter>;
  const view = render(shell('original')); fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  view.rerender(shell('hidden')); view.rerender(shell('changed'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(api.post).not.toHaveBeenCalled(); expect(screen.getByText('Selection or version changed. Select the source and annotations again.')).toBeVisible();
  expect(scopeControl()).toHaveValue(kind);
  openStaged(); fireEvent.click(screen.getByRole('button', { name: kind === 'selection' ? 'Use current selection' : 'Use current section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect((vi.mocked(api.post).mock.calls[0][1] as any).snapshot.assistTarget).toEqual(currentTarget);
});
it('consumes a sent scope so a new follow-up on another page uses that current document', async () => {
  const target = captureAssistTarget('unsaved current draft', 'selection', 0, 7, version)!;
  const shell = (other = false) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}><AgentSessionPanel key={String(other)} {...defaults} pageId={other ? 'page-b' : 'page-a'} assistRequest={other ? null : { id: 'scope-request', intent: 'Discuss this selection', assistTarget: target }} /></AgentSessionRegistryProvider></MemoryRouter>;
  vi.mocked(api.post).mockImplementation(async (_url, data: any) => ({ data: { ...turn, ...data, id: 'followup', pageSnapshot: data.snapshot, references: [], status: 'done' } }));
  const view = render(shell()); await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  view.rerender(shell(true)); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain this other page' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect((vi.mocked(api.post).mock.calls[1][1] as any).snapshot.assistTarget.kind).toBe('document');
});


describe('conversation scroll following', () => {
  let height: number;
  beforeEach(() => {
    height = 2000;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('agent-session-turns') ? height : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('agent-session-turns') ? 400 : 0; });
    turns = Array.from({ length: 20 }, (_, i) => ({ ...turn, id: `history-${i}` }));
  });
  const viewport = (container: HTMLElement) => container.querySelector('.agent-session-turns') as HTMLDivElement;
  it('opens a long conversation at its newest turn', async () => {
    const rendered = render(tree()); await screen.findAllByText('Earlier answer');
    await waitFor(() => expect(viewport(rendered.container).scrollTop).toBe(1600));
  });
  it('forces following when the user sends from older history', async () => {
    const rendered = render(tree()); await screen.findAllByText('Earlier answer');
    const list = viewport(rendered.container); list.scrollTop = 300; fireEvent.scroll(list); height = 2400;
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Follow-up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByRole('button', { name: 'Stop' });
    await waitFor(() => expect(list.scrollTop).toBe(2000));
  });
  it.each([true, false])('follows polled streaming replies only when near the bottom (%s)', async (nearBottom) => {
    turns[turns.length - 1] = { ...turns[turns.length - 1], status: 'running', result: null, progressText: 'Working' };
    const rendered = render(tree()); await screen.findByText('Working');
    const list = viewport(rendered.container);
    await waitFor(() => expect(list.scrollTop).toBe(1600));
    list.scrollTop = 300; fireEvent.scroll(list);
    if (nearBottom) { list.scrollTop = 1580; fireEvent.scroll(list); }
    height = 2400;
    turns = turns.map((item, i) => i === turns.length - 1 ? { ...item, status: 'done', result: { summary: 'New streamed answer' } } : item);
    await screen.findByText('New streamed answer');
    await waitFor(() => expect(list.scrollTop).toBe(nearBottom ? 2000 : 300));
  });
  it('positions a newly selected conversation independently of the previous history scroll', async () => {
    const second = { ...summary, id: 'session-b', title: 'Conversation B' };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : { ...(url.endsWith('session-b') ? second : summary), turns } }));
    const rendered = render(tree()); await screen.findAllByText('Earlier answer');
    const list = viewport(rendered.container); list.scrollTop = 300; fireEvent.scroll(list); height = 3000;
    selectConversation('session-b');
    await screen.findAllByText('Earlier answer'); await waitFor(() => expect(list.scrollTop).toBe(2600));
  });
  it('keeps new activity visible when a delayed programmatic scroll arrives after content grows', async () => {
    const callbacks = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(element: Element) { callbacks.set(element, this.callback); } disconnect() {} });
    try {
      const rendered = render(tree()); await screen.findAllByText('Earlier answer'); const list = viewport(rendered.container);
      await waitFor(() => expect(list.scrollTop).toBe(1600));
      list.scrollTop = 300; fireEvent.scroll(list);
      fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Follow-up with no answer yet' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByRole('button', { name: 'Stop' });
      await waitFor(() => expect(list.scrollTop).toBe(1600));
      for (const nextHeight of [2093, 2400]) {
        // The browser queues the scroll event from our previous scrollTop write.
        // New phase/answer layout grows before that event is dispatched.
        height = nextHeight; fireEvent.scroll(list);
        act(() => callbacks.get(list)?.([], {} as ResizeObserver));
        await waitFor(() => expect(list.scrollTop).toBe(nextHeight - 400));
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not pull a user back down after a small upward scroll near the bottom', async () => {
    turns[turns.length - 1] = { ...turns[turns.length - 1], status: 'running', result: null, progressText: 'Working' };
    const rendered = render(tree()); await screen.findByText('Working'); const list = viewport(rendered.container);
    await waitFor(() => expect(list.scrollTop).toBe(1600));
    list.scrollTop = 1580; fireEvent.scroll(list); height = 2400;
    turns = turns.map((item, i) => i === turns.length - 1 ? { ...item, status: 'done', result: { summary: 'Final answer' } } : item);
    await screen.findByText('Final answer');
    await new Promise((resolve) => setTimeout(resolve, 35)); expect(list.scrollTop).toBe(1580);
  });
  it('follows delayed content resize and disconnects the observer on unmount', async () => {
    const callbacks = new Map<Element, ResizeObserverCallback>(), disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(element: Element) { callbacks.set(element, this.callback); } disconnect = disconnect; });
    try {
      const rendered = render(tree()); await screen.findAllByText('Earlier answer'); const list = viewport(rendered.container);
      list.scrollTop = 1600; fireEvent.scroll(list); height = 2500; act(() => callbacks.get(list)?.([], {} as ResizeObserver));
      await waitFor(() => expect(list.scrollTop).toBe(2100));
      list.scrollTop = 250; fireEvent.scroll(list); height = 2800; act(() => callbacks.get(list)?.([], {} as ResizeObserver));
      await new Promise((resolve) => setTimeout(resolve, 35)); expect(list.scrollTop).toBe(250);
      rendered.unmount(); expect(disconnect).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('compact conversation interaction', () => {
  it('sends with Enter, leaves Shift+Enter for a newline, and ignores composition confirmation', async () => {
    render(tree()); await screen.findByText('Earlier answer');
    const message = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(message, { target: { value: 'Explain the document' } });
    expect(fireEvent.keyDown(message, { key: 'Enter', shiftKey: true })).toBe(true);
    fireEvent.compositionStart(message);
    fireEvent.keyDown(message, { key: 'Enter' });
    fireEvent.compositionEnd(message);
    fireEvent.keyDown(message, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(message, { key: 'Enter', keyCode: 229 });
    expect(api.post).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(message, { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ intent: 'Explain the document', pageId: 'page-a' });
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
    fireEvent.keyDown(message, { key: 'Enter' });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('opens the reference search from @ and returns to the intact message after a selection', async () => {
    render(tree()); await screen.findByText('Earlier answer');
    const message = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(message, { target: { value: 'Compare with @' } });
    const search = await screen.findByRole('textbox', { name: 'Find reference pages' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'Reference' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Reference B' }));
    expect(screen.queryByRole('dialog', { name: 'Reference pages' })).not.toBeInTheDocument();
    expect(message).toHaveFocus(); expect(message).toHaveValue('Compare with ');
    expect(screen.getByRole('button', { name: 'Remove Reference B' })).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not open the reference search for email addresses or while composing', async () => {
    render(tree()); await screen.findByText('Earlier answer');
    const message = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(message, { target: { value: 'mail@' } });
    expect(screen.queryByRole('dialog', { name: 'Reference pages' })).not.toBeInTheDocument();
    fireEvent.compositionStart(message);
    fireEvent.change(message, { target: { value: '文字 @' } });
    expect(screen.queryByRole('dialog', { name: 'Reference pages' })).not.toBeInTheDocument();
    fireEvent.compositionEnd(message);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps per-conversation drafts and keyboard focus while moving between tabs', async () => {
    const second = { ...summary, id: 'session-b', title: 'Conversation B' };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Draft A' } });
    const first = screen.getByRole('tab', { name: 'Conversation A' });
    first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' });
    await screen.findByText('Start a conversation about this document.');
    const secondTab = screen.getByRole('tab', { name: 'Conversation B' });
    expect(secondTab).toHaveFocus(); expect(secondTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Draft B' } });
    secondTab.focus(); fireEvent.keyDown(secondTab, { key: 'Home' });
    await screen.findByText('Earlier answer');
    expect(first).toHaveFocus(); expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Draft A');
    fireEvent.keyDown(first, { key: 'End' });
    await screen.findByText('Start a conversation about this document.');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Draft B');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens older conversations through history without replacing an unsent draft', async () => {
    const summaries = [summary, ...['b', 'c', 'd'].map((id) => ({ ...summary, id: `session-${id}`, title: `Conversation ${id.toUpperCase()}` }))];
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? summaries : { ...summaries.find((item) => url.endsWith(item.id)), turns: url.endsWith(summary.id) ? turns : [] } }));
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep draft A' } });
    expect(screen.queryByRole('tab', { name: 'Conversation D' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector<HTMLElement>('[aria-label="Conversation history"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Conversation D' }));
    await screen.findByText('Start a conversation about this document.');
    expect(screen.getByRole('tab', { name: 'Conversation D' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector<HTMLDetailsElement>('.agent-conversation-history')?.open).toBe(false);
    selectConversation('session-a'); await screen.findByText('Earlier answer');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep draft A');
  });

  it('collapses context details while keeping staged notes explicit and recoverable', async () => {
    render(tree({ assistRequest: { id: 'compact-note', intent: 'Explain the note', annotations: [{ id: 'n', quote: 'unsaved', body: 'A staged note' }], noteIds: ['n'] } }));
    await screen.findByText('Earlier answer');
    expect(screen.getByText('1 page note · not sent')).toBeVisible();
    expect(screen.getByText('A staged note')).not.toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Edit scope' })).not.toBeInTheDocument();
    expect(screen.getByText('Original A')).not.toBeVisible();
    openStaged(); expect(screen.getByText('A staged note')).toBeVisible();
    expect(scopeControl()).toHaveValue('document');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove context and use the whole document' }));
    expect(screen.queryByText('1 page note · not sent')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Explain the note');
  });

  it('renders readable Markdown without executing raw HTML or unsafe links', async () => {
    turns = [{ ...turn, result: { summary: '**Decision**\n\n- First item\n- [Page link](/pages/page-b)\n\n```js\nconst value = 1;\n```\n\n[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src="https://example.com/track">' } }];
    const rendered = render(tree());
    const decision = await screen.findByText('Decision');
    expect(decision.tagName).toBe('STRONG');
    expect(screen.getByText('First item').tagName).toBe('LI');
    expect(screen.getByRole('link', { name: 'Page link' })).toHaveAttribute('href', '/pages/page-b');
    expect(screen.getByRole('link', { name: 'Page link' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('const value = 1;').tagName).toBe('CODE');
    expect(screen.getByText('Unsafe')).not.toHaveAttribute('href', expect.stringContaining('javascript:'));
    expect(rendered.container.querySelector('.agent-reply-content script, .agent-reply-content img')).toBeNull();
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
  });
});

it('keeps empty proposal feedback visible and offers an explicit regeneration', async () => {
  turns = [{ ...turn, mode: 'proposal', result: { summary: 'No changes returned' } }];
  render(tree());
  expect(await screen.findByText('Assistant returned no usable content. Your draft is unchanged.')).toBeVisible();
  expect(screen.getByText('Retry needed')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate from current draft' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Earlier question');
  expect(api.post).not.toHaveBeenCalled();
});

it('keeps acceptance and the separate Save requirement visible after collapsing a reviewed diff', async () => {
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: { title: 'Page A', content: 'unsaved current draft', updatedAt: version }, result: { changes: 'Changed draft' } }];
  const apply = vi.fn(() => true);
  render(tree({ onApply: apply }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept to draft' }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Accepted to draft. Save the page to publish these changes.')).toBeVisible();
  expect(screen.getByText(/Acceptance record: previously accepted into the draft/)).not.toBeVisible();
  fireEvent.click(screen.getByText('About this acceptance record'));
  expect(screen.getByText(/Acceptance record: previously accepted into the draft/)).toBeVisible();
  expect(document.querySelector<HTMLDetailsElement>('.agent-candidate-details')?.open).toBe(false);
  expect(api.patch).not.toHaveBeenCalled();
});

it('dismisses context settings with Escape or an outside pointer without taking focus', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  const settings = document.querySelector<HTMLElement>('[aria-label="Context settings"]')!;
  fireEvent.click(settings);
  expect(scopeControl()).toBeVisible();
  fireEvent.keyDown(settings, { key: 'Escape' });
  expect(settings.closest('details')?.open).toBe(false); expect(settings).toHaveFocus();
  fireEvent.click(settings);
  const message = screen.getByRole('textbox', { name: 'Message' });
  message.focus(); fireEvent.pointerDown(message);
  expect(settings.closest('details')?.open).toBe(false); expect(message).toHaveFocus();
});

it('keeps a cancelled @ trigger and preserves literal @ when adding from the plus button', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  const message = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(message, { target: { value: 'Ask @' } });
  fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Find reference pages' }), { key: 'Escape' });
  expect(message).toHaveValue('Ask @');
  fireEvent.click(screen.getByRole('button', { name: 'Reference pages' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Find reference pages' }), { target: { value: 'Reference' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Add Reference B' }));
  expect(message).toHaveValue('Ask @');
});
it('renders context settings outside the clipping chat containers', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  fireEvent.click(document.querySelector<HTMLElement>('[aria-label="Context settings"]')!);
  const control = await screen.findByRole('combobox', { name: 'Edit scope' });
  expect(control.closest('.agent-settings-popover')?.parentElement).toBe(document.body);
  expect(control).toHaveFocus();
});

it('removes only the inserted @ at the cursor and preserves the surrounding message', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  const message = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(message, { target: { value: 'Before @ after @literal', selectionStart: 8 } });
  fireEvent.change(await screen.findByRole('textbox', { name: 'Find reference pages' }), { target: { value: 'Reference' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Add Reference B' }));
  expect(message).toHaveValue('Before  after @literal');
});

it.each([false, true])('closes context settings on Tab and continues beside its trigger (shift=%s)', async (shiftKey) => {
  render(tree()); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'A question' } });
  const trigger = document.querySelector<HTMLElement>('[aria-label="Context settings"]')!;
  fireEvent.click(trigger); const control = screen.getByRole('combobox', { name: 'Edit scope' });
  fireEvent.keyDown(control, { key: 'Tab', shiftKey });
  expect(screen.queryByRole('combobox', { name: 'Edit scope' })).not.toBeInTheDocument();
  expect(shiftKey ? screen.getByRole('textbox', { name: 'Message' }) : screen.getByRole('button', { name: 'Send' })).toHaveFocus();
});
it('closes context settings on blur to the browser without forcing focus back', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  const trigger = document.querySelector<HTMLElement>('[aria-label="Context settings"]')!;
  fireEvent.click(trigger);
  fireEvent.blur(screen.getByRole('combobox', { name: 'Edit scope' }), { relatedTarget: null });
  expect(screen.queryByRole('combobox', { name: 'Edit scope' })).not.toBeInTheDocument();
  expect(trigger).not.toHaveFocus();
});


describe('execution feedback', () => {
  it('responds immediately while sending and keeps phase feedback separate from the answer', async () => {
    let finish!: (value: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as any);
    const view = render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'A slow request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Sending request');
    expect(screen.getByText('0s elapsed')).toBeVisible();
    expect(view.container.querySelector('.agent-activity .agent-reply-content')).toBeNull();
    await act(async () => finish({ data: { ...turn, id: 'sent', result: { summary: 'Completed' } } }));
    expect(screen.queryByRole('status', { name: 'Agent activity' })).not.toBeInTheDocument();
  });
  it('shows actual execution phases and retries even before any answer exists', async () => {
    turns = [{ ...turn, status: 'running', result: null, progressText: '', progress: { phase: 'waiting', attempt: 2 } }];
    render(tree());
    const status = await screen.findByRole('status', { name: 'Agent activity' });
    expect(status).toHaveTextContent('Waiting for model'); expect(status).toHaveTextContent('Retry · attempt 2');
    expect(document.querySelector('.agent-reply-content')).toBeNull();
    turns = [{ ...turn, status: 'running', result: null, progressText: 'Real answer', progress: { phase: 'generating', attempt: 2 } }];
    expect(await screen.findByText('Real answer', {}, { timeout: 2000 })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Generating response');
    expect(screen.getByText('Real answer').closest('.agent-activity')).toBeNull();
    turns = [{ ...turn, result: { summary: 'Completed answer' } }];
    await screen.findByText('Completed answer', {}, { timeout: 2000 });
    expect(screen.queryByRole('status', { name: 'Agent activity' })).not.toBeInTheDocument();
  });
  it.each(['queued', 'running'] as const)('keeps an empty %s turn visible without a duplicate generating candidate', async (status) => {
    turns = [{ ...turn, mode: 'proposal', status, result: null, progressText: '' }];
    render(tree());
    expect(await screen.findByRole('status', { name: 'Agent activity' })).toHaveTextContent(status === 'queued' ? 'Queued for execution' : 'Agent is working');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Candidate review' })).not.toBeInTheDocument();
  });
});
