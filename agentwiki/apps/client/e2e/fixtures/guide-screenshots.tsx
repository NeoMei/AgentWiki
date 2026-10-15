// Screenshot-only examples. Real product components render fictional English data;
// the adapter never connects to a server or performs a write. Agent transcripts
// are illustrative messages, not evidence of a model run or a production publish.
import { useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Bot, User } from 'lucide-react';
import api from '../../src/api/client';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { Markdown } from '../../src/components/Markdown';
import { AgentList } from '../../src/features/agent/AgentList';
import { AgentDetail } from '../../src/features/agent/AgentDetail';
import { SpaceMembers } from '../../src/features/space/SpaceMembers';
import { PagePreview } from '../../src/features/page/PagePreview';
import { SpaceWorkspaceProvider } from '../../src/features/space-workspace/SpaceWorkspaceContext';
import { SpaceWorkspaceScope } from '../../src/features/space-workspace/SpaceWorkspaceScope';
import { AgentSessionRegistryProvider } from '../../src/features/agent-session/AgentSessionRegistry';
import '../../src/index.css';

const user = { id: 'guide-owner', name: 'Alex Morgan', email: 'alex@example.com' };
const space = { id: 'product-handbook', name: 'Product Handbook', members: [{ userId: user.id, role: 'owner' }] };
const agent = {
  id: 'handbook-assistant', name: 'Handbook Assistant', status: 'active',
  description: 'Maintains the product handbook and release documentation.',
  grants: [{ id: 'guide-grant', spaceId: space.id, space, role: 'publisher' }],
  credentials: [], _count: { credentials: 1, auditEvents: 3 },
};
const date = '2026-10-15T09:30:00.000Z';
const change = { id: 'handbook-update', title: 'Publish release checklist', status: 'published' };
const page = {
  id: 'release-checklist', spaceId: space.id, title: 'Release checklist', format: 'markdown',
  author: user, createdAt: date, updatedAt: date, capabilities: { canEdit: true },
  content: `## Before you publish

Use this checklist to prepare a product release and keep the team informed.

| Task | Owner | Status |
| --- | --- | --- |
| Review the release notes | Product team | Complete |
| Verify the main user flows | QA team | Complete |
| Confirm the rollback plan | Engineering | Ready |

## After the release

Check the live version, review the activity log, and share the release notes with the team.
`,
  provenance: {
    ...change, createdByAgent: agent, publishedAt: date, approvals: [],
    run: { id: 'handbook-sync', status: 'completed', source: { name: 'Product Handbook', type: 'markdown', uri: 'docs/release-checklist.md' } },
  },
  lastChange: change, lastModifiedByAgent: agent, lastModifiedAt: date,
};
const members = [
  { id: 'owner-member', type: 'human', role: 'owner', userId: user.id, user, createdAt: date },
  { id: 'agent-member', type: 'agent', role: 'publisher', agentId: agent.id, agent, canManageRole: true, createdAt: date },
];
const activity = ['get_page', 'propose_page', 'list_spaces'].map((tool, index) => ({
  id: `guide-event-${index}`, action: `mcp.tool.${tool}`, outcome: 'success', createdAt: date,
  resourceType: index === 2 ? 'Space' : 'Page', resourceId: index === 2 ? space.id : page.id,
  metadata: { resultSummary: index === 2 ? { count: 1 } : { status: 'published' } },
}));

localStorage.clear();
localStorage.setItem('agentwiki.language.v1', 'en');
localStorage.setItem('user', JSON.stringify(user));
// Synthetic fixture identity only; all requests are handled by the adapter below.
localStorage.setItem('token', 'guide-fixture');
api.defaults.adapter = async (config) => {
  const url = config.url?.split('?')[0];
  if (config.method !== 'get') throw new Error('Guide screenshots cannot write data');
  let data: unknown;
  if (url === '/agents') data = [agent];
  else if (url === `/agents/${agent.id}`) data = agent;
  else if (url === `/agents/${agent.id}/activity`) data = { data: activity };
  else if (url === '/spaces') data = { data: [space], hasMore: false };
  else if (url === `/spaces/${space.id}/members`) data = members;
  else if (url === `/pages/${page.id}`) data = page;
  else if (url === `/spaces/${space.id}/pages/${page.id}/notes`) data = { notes: [], canCreate: true };
  else if (url === `/knowledge/related/${page.id}`) data = { pages: [], relations: [] };
  else throw new Error(`Missing guide screenshot fixture: ${url}`);
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

function Document() {
  const ignore = useCallback(() => {}, []);
  return <SpaceWorkspaceScope mode="read" spaceId={space.id} activeSection="pages"
    selectedFolderId={null} selectedPageId={page.id} selectedPageFolderId={null} pageRefreshRequest={0}
    selectFolder={ignore} reportPageIdentity={ignore} requestPageRefresh={ignore}>
    <PagePreview />
  </SpaceWorkspaceScope>;
}

const conversations = {
  publish: {
    prompt: 'Connect to AgentWiki with the instructions I supplied. Check the Product Handbook space, then publish an English page called “Release checklist”.',
    answer: `I will verify the connection and the granted role before writing.

1. Check the **Handbook Assistant** identity and **Product Handbook** access.
2. Read the Space review policy and confirm the **Publisher** role.
3. Prepare **Release checklist** with tasks for Product, QA, and Engineering.
4. Submit the page, then read it back and check the activity log.

Publishing follows the Space review policy. An Agent cannot approve a human review.`,
  },
  result: {
    prompt: 'Show me the connection and publishing result.',
    answer: `### Connection and publishing result

| Check | Example result |
| --- | --- |
| Agent identity | Handbook Assistant |
| Authorized Space | Product Handbook |
| Agent role | Publisher |
| Space review policy | No review |
| Page | Release checklist |
| Publication | Published under the Space policy |

The page has been read back in AgentWiki. The activity log records the corresponding MCP calls.`,
  },
  'local-preview': {
    prompt: 'Inspect ./docs for the Product Handbook space. Show the preview before uploading anything.',
    answer: `### Local knowledge preview

| Change | Files |
| --- | --- |
| Added | 1 — release-checklist.md |
| Updated / deleted | 0 / 0 |
| Unchanged / skipped | 2 / 0 |
| Upload size | 2.4 KB |

**Target:** Product Handbook · **Preview:** handbook-preview

No content has been uploaded. No remote model is used in this example.

**Sync this preview to AgentWiki?**`,
  },
  'local-result': {
    prompt: 'Yes, sync the handbook-preview I just reviewed to Product Handbook.',
    answer: `### Synchronization result

| Item | Example result |
| --- | --- |
| Source | Product Handbook docs |
| Run | handbook-sync · completed |
| ChangeSet | handbook-update |
| Page | Release checklist |
| Review status | Published under the Space policy |

The example Space uses **No review** and the Agent has **Publisher** access. With **Always review**, the change would wait for a human reviewer.`,
  },
};

function Conversation({ kind }: { kind: keyof typeof conversations }) {
  const example = conversations[kind];
  return <div className="mx-auto max-w-4xl rounded-xl border border-gray-200 bg-white">
    <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4 text-sm font-semibold"><Bot size={18} /> Local Agent <span className="ml-auto text-xs font-normal text-gray-500">Illustrative conversation</span></div>
    <div className="space-y-6 p-6">
      <div className="flex gap-3"><User size={18} className="mt-1 shrink-0 text-gray-500" /><p className="rounded-lg bg-gray-50 px-4 py-3 text-sm leading-6">{example.prompt}</p></div>
      <div className="flex gap-3"><Bot size={18} className="mt-1 shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><Markdown>{example.answer}</Markdown></div></div>
    </div>
  </div>;
}

const view = new URLSearchParams(location.search).get('view') || 'agents';
const route = view === 'agents' ? '/agents' : view === 'members' ? `/spaces/${space.id}/members` : view === 'page' ? `/pages/${page.id}` : `/agents/${agent.id}`;
const root = createRoot(document.getElementById('root')!);
root.render(<MemoryRouter initialEntries={[route]}><AuthProvider><LanguageProvider>
  <AgentSessionRegistryProvider userId={user.id}><SpaceWorkspaceProvider userId={user.id}>
    <main data-guide-capture className="bg-white p-8">
      <div className="mb-6 flex items-center justify-between border-b border-gray-100 pb-4 text-xs text-gray-500"><span className="font-semibold text-blue-600">AgentWiki · Product Handbook</span><span>English guide · Sample data</span></div>
      {view in conversations ? <Conversation kind={view as keyof typeof conversations} /> : <Routes>
        <Route path="/agents" element={<AgentList />} />
        <Route path="/agents/:id" element={<AgentDetail />} />
        <Route path="/spaces/:id/members" element={<SpaceMembers />} />
        <Route path="/pages/:id" element={<Document />} />
      </Routes>}
    </main>
  </SpaceWorkspaceProvider></AgentSessionRegistryProvider>
</LanguageProvider></AuthProvider></MemoryRouter>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
