import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '../../src/api/client';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider, useLanguage } from '../../src/context/LanguageContext';
import { RunStartWizard } from '../../src/features/collaboration/RunStartWizard';
import { TaskPanel } from '../../src/features/collaboration/components/TaskPanel';
import { validDefinition } from '../../src/features/collaboration/collaboration-test-fixtures';
import type { CollaborationRun, TemplateDetail } from '../../src/features/collaboration/types';
import '../../src/index.css';
import '../../src/features/collaboration/collaboration-workspace.css';

if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Local fixture only');
localStorage.setItem('user', JSON.stringify({ id: 'retest-user', platformRole: 'user' }));
localStorage.removeItem('agentwiki.collaboration.draft.retest-space.retest-template.retest-user');
localStorage.setItem('agentwiki.language.v1', new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh-CN');

const template: TemplateDetail = {
  id: 'retest-template', name: '个人测试模板 / Personal fixture', slug: 'personal-fixture',
  spaceId: 'retest-space', system: false, version: 1, description: '',
  definition: { ...validDefinition, inputs: [
    { key: 'brief', label: '工作说明 / Work brief', required: true, type: 'long_text' },
    { key: '2', label: '范围 / Scope', required: true, type: 'short_text' },
    { key: 'count', label: '数量 / Count', required: true, type: 'number' },
    { key: 'enabled', label: '启用 / Enabled', required: true, type: 'boolean' },
    { key: 'note', label: '备注 / Note', required: false, type: 'short_text' },
  ] },
};
const members = [
  { type: 'human', userId: 'retest-user', role: 'owner' },
  { type: 'agent', agentId: 'retest-agent', role: 'editor', agent: { id: 'retest-agent', name: 'Write Page / opencode', status: 'active', revokedAt: null } },
];
let submitted: unknown = null;
api.defaults.adapter = async (config) => {
  const url = config.url ?? '';
  let data: unknown;
  if (config.method === 'get' && url.endsWith('/templates/retest-template')) data = template;
  else if (config.method === 'get' && url.endsWith('/members')) data = members;
  else if (config.method === 'post' && url.endsWith('/runs/drafts')) {
    submitted = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    data = { id: 'retest-draft', status: 'draft', version: 1, ...(submitted as object), updatedAt: '2026-10-16T00:00:00Z' };
    window.dispatchEvent(new Event('retest-draft-submitted'));
  } else throw new Error(`Fixture rejects unhandled API request: ${config.method} ${url}`);
  return { config, data, headers: {}, status: 200, statusText: 'OK' };
};

const task = {
  id: 'task-1', nodeId: 'write-page', ordinal: 0, name: 'Write Page',
  objectivePreview: 'Produce the complete Markdown content for the target Page',
  roleSlotId: 'writer', assigneeAgentId: 'retest-agent', status: 'ready', generation: 1, skippable: false,
  todos: [{ id: 'todo-1', ordinal: 0, name: 'Write the target Page', status: 'pending', required: true, generation: 1 }],
  attempts: [], artifacts: [],
};
function Fixture() {
  const { t, toggleLanguage } = useLanguage();
  const [custom, setCustom] = useState(false);
  const [history, setHistory] = useState(false);
  const [draft, setDraft] = useState<unknown>(null);
  React.useEffect(() => {
    const update = () => setDraft(submitted);
    window.addEventListener('retest-draft-submitted', update);
    return () => window.removeEventListener('retest-draft-submitted', update);
  }, []);
  const run = {
    id: 'retest-run', name: '用户运行 / User run', status: history ? 'completed' : 'running', version: 1,
    roleBindings: [], updatedAt: '2026-10-16T00:00:00Z', systemTemplateSource: custom ? null : { slug: 'single-page' },
    tasks: [task, { ...task, id: 'custom-task', ordinal: 1, name: '用户文字 / User text',
      objectivePreview: 'Keep my words / 保留原文', todos: [] }],
  } as CollaborationRun;
  return <main style={{ padding: 16, maxWidth: 1200, margin: 'auto' }}>
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
      <button onClick={toggleLanguage}>中文 / English</button>
      <label><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> 历史运行 / Historical run</label>
      <label><input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> 自定义工作流 / Custom workflow</label>
    </nav>
    <MemoryRouter initialEntries={['/spaces/retest-space/collaboration/templates/retest-template/start']}>
      <Routes><Route path="/spaces/:id/collaboration/templates/:templateId/start" element={<RunStartWizard />} /></Routes>
    </MemoryRouter>
    <pre aria-label="Submitted draft" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 24 }}>{draft ? JSON.stringify(draft, null, 2) : '尚未提交 / Not submitted'}</pre>
    <section className="aw-collab" style={{ marginTop: 32 }} aria-label="Single-page task fixture">
      <TaskPanel run={run} t={t} onAction={() => {}} onHistory={() => {}} agentNames={new Map([['retest-agent', 'Write Page / opencode']])} />
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<AuthProvider><LanguageProvider><Fixture /></LanguageProvider></AuthProvider>);
