import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import api from '../../api/client';
import { NotesBrowser } from './NotesBrowser';

const auth = vi.hoisted(() => ({ user: { id: 'alice' } as { id: string } | null, token: 'alice-token' as string | null }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(api.get);
const note = (id = 'n1', pageId = 'other-page') => ({ id, pageId, spaceId: 's1', body: `Note ${id}`, target: { kind: 'selection', quote: 'An old passage', prefix: '', suffix: '', from: 0, to: 14 }, status: 'resolved', author: { type: 'user', id: 'bob', name: 'Bob' }, recipients: [], canEdit: false, createdAt: '2026-10-28T01:00:00Z', updatedAt: '2026-10-28T02:00:00Z', page: { id: pageId, title: 'Source page', folderPath: ['Research', 'October'] }, space: { id: 's1', name: 'Team Wiki' } });
const response = (notes = [note()], nextCursor: string | null = null) => ({ data: { notes, total: 3, nextCursor } });
const Location = () => { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search}</output>; };
function show(entry = '/spaces/s1/notes', embedded = false) {
 return render(<LanguageProvider><MemoryRouter initialEntries={[entry]}><Routes><Route path="*" element={<><NotesBrowser spaceId="s1" embedded={embedded} currentPage={embedded ? { id: 'current', title: 'Current document', openCount: 2 } : undefined} onReturnToCurrent={embedded ? returnToCurrent : undefined} /><Location /></>} /></Routes></MemoryRouter></LanguageProvider>);
}
const returnToCurrent = vi.fn();
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe('NotesBrowser discovery', () => {
 beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); localStorage.setItem('agentwiki.language.v1', 'en'); auth.user = { id: 'alice' }; auth.token = 'alice-token'; get.mockResolvedValue(response()); });
 it('shows shared notes from other pages with source, author and time even for resolved or stale passages', async () => {
  show();
  expect(await screen.findByText('Note n1')).toBeInTheDocument();
  expect(screen.getByText('An old passage')).toBeInTheDocument();
  expect(screen.getByText('Research / October')).toBeInTheDocument();
  expect(screen.getByText('Team Wiki')).toBeInTheDocument();
  expect(screen.getByText('Bob')).toBeInTheDocument();
  expect(screen.getByText('Resolved', { selector: 'li span' })).toBeInTheDocument();
  expect(screen.getByLabelText('Note author')).toHaveValue('all');
  expect(screen.getByLabelText('Note status')).toHaveValue('all');
  expect(document.querySelector('time')).toHaveAttribute('dateTime', '2026-10-28T02:00:00Z');
 });
 it('keeps a compact current page summary and explicit return action in the embedded view', async () => {
  show('/pages/current', true);
  expect(screen.getByText('Current document')).toBeInTheDocument();
  expect(screen.getByText('2 open notes on this page')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Return to this page' }));
  expect(returnToCurrent).toHaveBeenCalledOnce();
  await screen.findByText('Note n1');
 });
 it('loads more results and resets the cursor/results after changing a filter', async () => {
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockResolvedValueOnce(response([note('n2')])).mockResolvedValueOnce(response([note('mine')]));
  show(); await screen.findByText('Note n1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Note n2')).toBeInTheDocument();
  expect(screen.getByText('Note n1')).toBeInTheDocument();
  expect(get).toHaveBeenNthCalledWith(2, '/page-notes', expect.objectContaining({ params: expect.objectContaining({ cursor: 'next-1' }) }));
  fireEvent.change(screen.getByLabelText('Note author'), { target: { value: 'me' } });
  expect(await screen.findByText('Note mine')).toBeInTheDocument();
  expect(screen.queryByText('Note n1')).not.toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith('/page-notes', expect.objectContaining({ params: expect.objectContaining({ author: 'me', cursor: undefined }) }));
 });
 it('searches all accessible spaces and preserves filters in the source link return context', async () => {
  show(); await screen.findByText('Note n1');
  fireEvent.change(screen.getByLabelText('Note scope'), { target: { value: 'all' } });
  fireEvent.change(screen.getByLabelText('Note author'), { target: { value: 'mentioned' } });
  fireEvent.change(screen.getByLabelText('Note status'), { target: { value: 'resolved' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'old passage' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/page-notes', expect.objectContaining({ params: expect.objectContaining({ spaceId: undefined, query: 'old passage', author: 'mentioned', status: 'resolved' }) })));
  const href = screen.getByRole('link', { name: /Open source page/ }).getAttribute('href')!;
  const target = new URL(href, 'https://local.test');
  expect(target.pathname).toBe('/pages/other-page'); expect(target.searchParams.get('note')).toBe('n1');
  const back = new URL(target.searchParams.get('notesReturn')!, 'https://local.test');
  expect(back.pathname).toBe('/spaces/s1/notes'); expect(back.searchParams.get('query')).toBe('old passage'); expect(back.searchParams.get('scope')).toBe('all');
 });
 it('restores return URL filters instead of a default and safely encodes source identifiers', async () => {
  get.mockResolvedValue(response([note('n/?#', 'page/?#')]));
  show('/spaces/s1/notes?scope=all&author=me&status=open&query=stored');
  await screen.findByText('Note n/?#');
  expect(screen.getByRole('searchbox')).toHaveValue('stored');
  expect(screen.getByLabelText('Note author')).toHaveValue('me');
  const link = screen.getByRole('link', { name: /Open source page/ });
  expect(link.getAttribute('href')).toMatch(/^\/pages\/page%2F%3F%23\?/);
 });
 it('retries a failed first read without losing filters', async () => {
  get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  show('/spaces/s1/notes?query=retained');
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load notes');
  expect(screen.getByRole('searchbox')).toHaveValue('retained');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Note n1')).toBeInTheDocument();
 });
 it('rejects a late result from the preceding query', async () => {
  const old = deferred<ReturnType<typeof response>>(); get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response([note('new')]));
  show(); fireEvent.change(screen.getByLabelText('Note status'), { target: { value: 'open' } });
  await screen.findByText('Note new');
  await act(async () => old.resolve(response([note('old')])));
  expect(screen.queryByText('Note old')).not.toBeInTheDocument();
 });
 it('clears old-user results and ignores their late response on an account switch', async () => {
  const old = deferred<ReturnType<typeof response>>(); get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response([note('bob')]));
  const view = render(<LanguageProvider><MemoryRouter><NotesBrowser spaceId="s1" /></MemoryRouter></LanguageProvider>); auth.user = { id: 'bob' }; auth.token = 'bob-token';
  view.rerender(<LanguageProvider><MemoryRouter><NotesBrowser spaceId="s1" /></MemoryRouter></LanguageProvider>);
  await screen.findByText('Note bob');
  await act(async () => old.resolve(response([note('alice')])));
  expect(screen.queryByText('Note alice')).not.toBeInTheDocument();
 });
 it('retains embedded filters per user and keeps another account defaults separate', async () => {
  const first = show('/pages/current', true); await screen.findByText('Note n1');
  fireEvent.change(screen.getByLabelText('Note author'), { target: { value: 'me' } });
  first.unmount(); const second = show('/pages/current', true);
  expect(screen.getByLabelText('Note author')).toHaveValue('me'); second.unmount();
  auth.user = { id: 'bob' }; auth.token = 'bob-token'; show('/pages/current', true);
  expect(screen.getByLabelText('Note author')).toHaveValue('all');
  await screen.findByText('Note n1');
 });
 it('offers a clear empty state without pretending a failed read is empty', async () => {
  get.mockResolvedValue({ data: { notes: [], total: 0, nextCursor: null } });
  show(); expect(await screen.findByText('No notes match these filters.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
 });
 it('clears previously visible notes when pagination discovers revoked access', async () => {
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockRejectedValueOnce({ response: { status: 403 } });
  show(); await screen.findByText('Note n1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Note n1')).not.toBeInTheDocument();
 });
 it('retries the failed next page while retaining already loaded results', async () => {
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response([note('second')]));
  show(); await screen.findByText('Note n1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByRole('alert');
  expect(screen.getByText('Note n1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Note second')).toBeInTheDocument(); expect(screen.getByText('Note n1')).toBeInTheDocument();
 });
 it('shows the Chinese filters and preserves the shared-note meaning', async () => {
  localStorage.setItem('agentwiki.language.v1', 'zh-CN'); show(); await screen.findByText('Note n1');
  expect(screen.getByLabelText('笔记作者')).toHaveValue('all');
  expect(screen.getByText('查找有访问权限页面中的共享笔记。仅原作者可修改笔记。')).toBeInTheDocument();
 });

 it('restores freshly fetched result pages and the selected card when returning from a source page', async () => {
  const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockResolvedValueOnce(response([note('second')], 'next-2'));
  const first = show(); await screen.findByText('Note n1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('Note second');
  const href = screen.getAllByRole('link', { name: /Open source page/ })[1].getAttribute('href')!;
  fireEvent.click(screen.getAllByRole('link', { name: /Open source page/ })[1]); first.unmount();
  const back = new URL(href, 'https://local.test').searchParams.get('notesReturn')!;
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockResolvedValueOnce(response([note('second')], 'next-2'));
  show(back);
  expect(await screen.findByText('Note second')).toBeInTheDocument();
  await waitFor(() => expect(scroll).toHaveBeenCalled());
 });
 it('marks results from the current page without hiding other shared-page results', async () => {
  get.mockResolvedValue(response([note('current-note', 'current'), note('other-note')]));
  show('/pages/current', true); await screen.findByText('Note current-note');
  expect(screen.getByText('Current page')).toBeInTheDocument();
  expect(screen.getByText('Note other-note')).toBeInTheDocument();
 });
 it('clears an empty search back to current-space, all-author and all-status defaults', async () => {
  get.mockResolvedValueOnce({ data: { notes: [], total: 0, nextCursor: null } }).mockResolvedValueOnce(response());
  show('/spaces/s1/notes?query=missing&scope=all&author=me&status=resolved');
  await screen.findByText('No notes match these filters.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByText('Note n1')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue(''); expect(screen.getByLabelText('Note scope')).toHaveValue('space');
 });

 it('does not persist note bodies and expires restoration after ten minutes', async () => {
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockResolvedValueOnce(response([note('second')]));
  const first = show(); await screen.findByText('Note n1'); fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('Note second');
  fireEvent.click(screen.getAllByRole('link', { name: /Open source page/ })[1]); first.unmount();
  const storageKey = Object.keys(sessionStorage).find(key => key.includes('notes-discovery.resume'))!;
  const saved = JSON.parse(sessionStorage.getItem(storageKey)!);
  expect(saved).toMatchObject({ pages: 2, noteId: 'second' });
  expect(sessionStorage.getItem(storageKey)).not.toContain('Note second');
  sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }));
  get.mockResolvedValueOnce(response([note()], 'next-1')); show();
  await screen.findByText('Note n1'); expect(screen.queryByText('Note second')).not.toBeInTheDocument();
 });

 it('discards prior cards when a successful next-page response has no authorized notes', async () => {
  get.mockResolvedValueOnce(response([note()], 'next-1')).mockResolvedValueOnce({ data: { notes: [], total: 0, nextCursor: null } });
  show(); await screen.findByText('Note n1'); fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('No notes match these filters.'); expect(screen.queryByText('Note n1')).not.toBeInTheDocument();
 });
 it('restarts from a fresh first page when accessible totals shrink between pages', async () => {
  const next = deferred<ReturnType<typeof response>>();
  get.mockResolvedValueOnce(response([note('revoked')], 'next-1'))
   .mockResolvedValueOnce({ data: { notes: [note('after-cursor')], total: 2, nextCursor: null } })
   .mockReturnValueOnce(next.promise);
  show(); await screen.findByText('Note revoked'); fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('Note revoked')).not.toBeInTheDocument();
  await act(async () => next.resolve({ data: { notes: [note('still-readable')], total: 2, nextCursor: null } }));
  expect(await screen.findByText('Note still-readable')).toBeInTheDocument(); expect(screen.queryByText('Note revoked')).not.toBeInTheDocument();
 });
 it('explains the bounded restore when the opened note was beyond five loaded pages', async () => {
  for (let index = 1; index <= 6; index++) get.mockResolvedValueOnce(response([note(`page-${index}`)], `cursor-${index}`));
  const first = show(); await screen.findByText('Note page-1');
  for (let index = 2; index <= 6; index++) { fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText(`Note page-${index}`); }
  const links = screen.getAllByRole('link', { name: /Open source page/ }); fireEvent.click(links[5]); first.unmount();
  for (let index = 1; index <= 5; index++) get.mockResolvedValueOnce(response([note(`page-${index}`)], `cursor-${index}`));
  show(); await screen.findByText('Note page-5');
  expect(await screen.findByText('Restored the first 5 pages. Search to find older notes.')).toBeInTheDocument();
  expect(screen.queryByText('Note page-6')).not.toBeInTheDocument();
 });

 it('bounds automatic restoration when live totals keep shrinking and restart pagination', async () => {
  get.mockResolvedValueOnce(response([note('first')], 'next-1')).mockResolvedValueOnce(response([note('second')]));
  const first = show(); await screen.findByText('Note first'); fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('Note second');
  fireEvent.click(screen.getAllByRole('link', { name: /Open source page/ })[1]); first.unmount();
  get.mockReset(); let total = 1000;
  const stopped = deferred<ReturnType<typeof response>>();
  get.mockImplementation(() => {
   if (get.mock.calls.length > 9) return stopped.promise;
   return Promise.resolve({ data: { notes: [note('fresh')], total: total--, nextCursor: 'live-next' } });
  });
  show(); expect(await screen.findByText('Results changed during restoration. Search to locate the note.')).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(9); expect(screen.getByText('Note fresh')).toBeInTheDocument();
 });

 it('drops old-space cards when access revision changes even if another new note keeps the total equal', async () => {
  const restarted = deferred<ReturnType<typeof response>>();
  get.mockResolvedValueOnce({ data: { notes: [note('lost-space')], total: 3, nextCursor: 'next-1', accessRevision: 'access-a-b' } })
   .mockResolvedValueOnce({ data: { notes: [note('new-in-readable-space')], total: 3, nextCursor: null, accessRevision: 'access-b' } })
   .mockReturnValueOnce(restarted.promise);
  show(); await screen.findByText('Note lost-space'); fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('Note lost-space')).not.toBeInTheDocument();
  await act(async () => restarted.resolve({ data: { notes: [note('authorized')], total: 3, nextCursor: null } }));
  expect(await screen.findByText('Note authorized')).toBeInTheDocument();
  expect(screen.queryByText('Note lost-space')).not.toBeInTheDocument();
 });
 it('does not revive old-space cards when the fresh revision read fails', async () => {
  get.mockResolvedValueOnce({ data: { notes: [note('lost-space')], total: 3, nextCursor: 'next-1', accessRevision: 'old-access' } })
   .mockResolvedValueOnce({ data: { notes: [note('new-card')], total: 3, nextCursor: null, accessRevision: 'new-access' } })
   .mockRejectedValueOnce(new Error('offline'));
  show(); await screen.findByText('Note lost-space'); fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert'); expect(screen.queryByText('Note lost-space')).not.toBeInTheDocument();
 });

});
