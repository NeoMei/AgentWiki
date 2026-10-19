import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentSessionRegistryProvider } from '../agent-session/AgentSessionRegistry';
import { SpaceWorkspaceProvider } from '../space-workspace/SpaceWorkspaceContext';
import { SpaceWorkspace } from '../space-workspace/SpaceWorkspace';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
const version = '2026-10-19T01:00:00.000Z';
const folder = { kind: 'folder', id: 'research', name: 'Research', path: '/Research', parentId: null, sortOrder: 0, hasChildren: false, createdAt: version, updatedAt: version };
const summary = { id: 'session-new', spaceId: 'space-a', title: 'Directory question', createdAt: version, updatedAt: version };
let navigate: ReturnType<typeof useNavigate>;
function Workspace() {
  navigate = useNavigate();
  return <SpaceWorkspace mode="directory" spaceId="space-a" showDirectory><></></SpaceWorkspace>;
}
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('agentwiki-language', 'en');
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    const params = config?.params as { parentFolderId?: string } | undefined;
    if (url === '/spaces/space-a') return { data: { id: 'space-a', name: 'Wiki', members: [{ userId: 'viewer', role: 'viewer' }] } };
    if (url === '/spaces/space-a/content-tree') return { data: { spaceId: 'space-a', parentFolderId: params?.parentFolderId ?? null, treeRevision: '7', data: params?.parentFolderId ? [] : [folder], nextCursor: null } };
    if (url === '/spaces/space-a/folders') return { data: { spaceId: 'space-a', treeRevision: '7', data: [folder], nextCursor: null } };
    if (url === '/assist/sessions') return { data: [] };
    if (url === '/assist/sessions/session-new') return { data: { ...summary, turns: [] } };
    return { data: { system: [], space: [], capabilities: {} } };
  });
  vi.mocked(api.post).mockImplementation(async (url, body: any) => ({ data: url === '/assist/sessions' ? summary : { ...body, id: 'turn-new', sessionId: summary.id, pageId: null, status: 'done', createdAt: version, pageSnapshot: null, references: [], noteIds: [], progressText: '', result: { summary: 'Read all eight pages.' }, error: null, directory: { folderId: body.directory.folderId, title: body.directory.folderId ? 'Research' : 'Wiki', recursive: true, pageCount: 8 } } }));
});
afterEach(cleanup);
it('opens Agent for a viewer at the root and follows directory navigation without requiring a page', async () => {
  render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-a']}><AgentSessionRegistryProvider userId="viewer"><SpaceWorkspaceProvider userId="viewer"><Routes><Route path="/spaces/:id" element={<Workspace />} /></Routes></SpaceWorkspaceProvider></AgentSessionRegistryProvider></MemoryRouter></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Agent' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Root draft' } });
  await act(async () => navigate('/spaces/space-a?folder=research'));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Read Research and every subfolder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Read all eight pages.');
  expect(vi.mocked(api.post).mock.calls.find(([url]) => url.endsWith('/turns'))?.[1]).toMatchObject({ mode: 'question', pageId: null, directory: { folderId: 'research', recursive: true } });
  expect(screen.getByLabelText('Directory read scope')).toHaveTextContent('Research · 8 pages · including subfolders');
  fireEvent.click(screen.getByRole('button', { name: 'Close Agent panel' }));
  expect(screen.queryByTestId('agent-session-panel')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ask Agent' })).toHaveFocus();
  await act(async () => navigate('/spaces/space-a'));
  fireEvent.click(screen.getByRole('button', { name: 'Ask Agent' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Root draft'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith('/turns'))).toHaveLength(2));
  expect(vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith('/turns'))[1][1]).toMatchObject({ pageId: null, directory: { folderId: null, recursive: true } });
});
