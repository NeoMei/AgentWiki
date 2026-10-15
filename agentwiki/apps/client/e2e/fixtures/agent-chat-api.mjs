// Local-only transport for the real PagePreview/PageEditor and AgentSessionPanel.
// Every response is synthetic; this is not production authentication or a model provider.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fixturePage, fixtureReferences, fixtureSessions, fixtureUser } from './agent-chat-data.mjs';
const requireServer = createRequire(new URL('../../../server/package.json', import.meta.url));
const { Server } = requireServer('socket.io');
const pages = new Map([fixturePage, ...fixtureReferences].map(page => [page.id, structuredClone(page)]));
const sessions = new Map(fixtureSessions.map(session => [session.id, structuredClone(session)]));
const pending = new Map();
const retries = new Map();
const now = () => new Date().toISOString();
const nextVersion = old => new Date(Math.max(Date.now(), Date.parse(old) + 1)).toISOString();
const sessionSummary = ({ turns: _turns, ...summary }) => summary;
const targetFor = quote => {
  const from = fixturePage.content.indexOf(quote);
  return { kind: 'selection', from, to: from + quote.length, quote, prefix: fixturePage.content.slice(Math.max(0, from - 48), from), suffix: fixturePage.content.slice(from + quote.length, from + quote.length + 48), baseUpdatedAt: fixturePage.updatedAt };
};
const notes = [
  { id: 'agent-chat-team-note', spaceId: fixturePage.spaceId, pageId: fixturePage.id, body: '建议把人工确认的范围整理成可验收的规则。', author: { type: 'user', id: 'agent-chat-product', name: '产品成员' }, target: targetFor('先核对本次选中的意见'), status: 'pending', createdAt: fixturePage.createdAt, updatedAt: fixturePage.updatedAt },
  { id: 'agent-chat-own-note', spaceId: fixturePage.spaceId, pageId: fixturePage.id, body: '请补充与需求编号关联的回归验收步骤。', author: { type: 'user', ...fixtureUser }, target: targetFor('由正在编辑文档的成员决定'), status: 'pending', createdAt: fixturePage.createdAt, updatedAt: fixturePage.updatedAt },
];
const noteDto = note => ({ ...note, canEdit: note.author.type === 'user' && note.author.id === fixtureUser.id });
function resultFor(turn) {
  if (turn.mode === 'proposal') {
    const source = turn.pageSnapshot.content;
    const target = turn.pageSnapshot.assistTarget;
    const addition = '\n\n### 验收补充\n\n- 每条评审意见关联需求编号，并记录负责人、验收步骤与结果。\n- 修改候选经人工审阅后接受到草稿，再执行原有保存流程。\n';
    const changes = target && target.kind !== 'document'
      ? source.slice(0, target.from) + target.quote + '\n\n验收时记录需求编号、复现步骤和修复反馈。\n' + source.slice(target.to)
      : source + addition;
    return { summary: '已整理一份修改候选：补充需求与验收记录的关联，并明确人工审阅步骤。请审阅后接受到草稿。', changes };
  }
  return { summary: `可以按以下步骤推进：\n\n1. **明确目标**：先确认这次讨论对应的需求与验收条件。\n2. **组织上下文**：使用当前文档${turn.references.length ? '和已选择的引用文档' : ''}，保留每条笔记的原文与作者。\n3. **审阅结果**：需要改动正文时先生成候选，由成员检查后接受。\n\n建议在 [开发测试与修复反馈](/pages/agent-chat-test-report) 中记录验证结果，形成可以追踪的协作过程。` };
}
function settle(session) {
  for (const turn of session.turns) {
    const job = pending.get(turn.id);
    if (!job || turn.status === 'cancelled') continue;
    if (Date.now() < job.completeAt) {
      turn.status = 'running';
      const elapsed = Date.now() - job.startedAt;
      turn.progress = { phase: elapsed < 1600 ? 'preparing' : elapsed < 3200 ? 'waiting' : Date.now() >= job.completeAt - 1600 ? 'finalizing' : 'generating', attempt: job.retry && elapsed >= 3200 ? 2 : 1 };
      turn.progressText = ''; // Real phases must not masquerade as streamed answer text.
    } else {
      turn.status = 'done'; delete turn.progress; turn.progressText = ''; turn.result = resultFor(turn);
      session.updatedAt = now(); pending.delete(turn.id);
    }
  }
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const path = url.pathname;
  const send = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
  try {
    if (request.headers.authorization !== `Bearer ${fixtureUser.id}`) return send(401, { message: 'Synthetic fixture identity required' });
    let input = {};
    if (!['GET', 'HEAD'].includes(request.method)) {
      let raw = ''; for await (const part of request) { raw += part; if (raw.length > 1_000_000) return send(413, { message: 'Fixture request too large' }); }
      input = JSON.parse(raw || '{}');
    }
    if (path === '/api/assist/sessions') {
      if (request.method === 'GET') return send(200, url.searchParams.get('spaceId') === fixturePage.spaceId ? [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(sessionSummary) : []);
      if (request.method === 'POST' && input.spaceId === fixturePage.spaceId) {
        const createdAt = now(); const session = { id: randomUUID(), spaceId: fixturePage.spaceId, title: '新会话', createdAt, updatedAt: createdAt, turns: [] };
        sessions.set(session.id, session); return send(201, sessionSummary(session));
      }
      return send(400, { message: 'Unknown fixture Space' });
    }
    const conversation = path.match(/^\/api\/assist\/sessions\/([^/]+)(\/turns)?$/u);
    if (conversation) {
      const session = sessions.get(conversation[1]);
      if (!session) return send(404, { message: 'Session not found' });
      settle(session);
      if (request.method === 'GET' && !conversation[2]) return send(200, session);
      if (request.method === 'POST' && conversation[2]) {
        const retryKey = `${session.id}:${input.clientRequestId}`;
        if (retries.has(retryKey)) return send(200, retries.get(retryKey));
        if (session.turns.some(turn => ['queued', 'running'].includes(turn.status))) return send(409, { message: 'A turn is already running' });
        if (!pages.has(input.pageId) || !input.snapshot || !input.intent?.trim() || !['question', 'proposal'].includes(input.mode)) return send(400, { message: 'Invalid fixture turn' });
        const referenceIds = input.referencePageIds ?? [];
        if (!Array.isArray(referenceIds) || referenceIds.some(id => !pages.has(id))) return send(403, { message: 'Reference outside fixture Space' });
        if (input.intent.includes('[fixture-error]')) return send(503, { message: '当前服务暂时不可用，请稍后重试。已填写的消息、引用文档和笔记仍保留在输入区。' });
        const turn = { id: randomUUID(), sessionId: session.id, pageId: input.pageId, mode: input.mode, intent: input.intent, status: 'queued', createdAt: now(), pageSnapshot: structuredClone(input.snapshot), references: referenceIds.map(id => ({ pageId: id, title: pages.get(id).title, updatedAt: pages.get(id).updatedAt })), noteIds: input.noteIds ?? [], annotations: input.annotations ?? [], progressText: '', result: null, error: null };
        if (!session.turns.length) session.title = input.intent.slice(0, 18);
        session.turns.push(turn); session.updatedAt = turn.createdAt;
        retries.set(retryKey, turn);
        pending.set(turn.id, { startedAt: Date.now(), completeAt: Date.now() + (/停止|stop/iu.test(input.intent) ? 20_000 : 10_400), retry: /重试|retry/iu.test(input.intent) });
        return send(201, turn);
      }
      return send(405, { message: 'Unsupported fixture method' });
    }
    const cancel = path.match(/^\/api\/assist\/tasks\/([^/]+)\/cancel$/u);
    if (cancel && request.method === 'POST') {
      const turn = [...sessions.values()].flatMap(session => session.turns).find(turn => turn.id === cancel[1]);
      if (!turn) return send(404, { message: 'Turn not found' });
      if (['queued', 'running'].includes(turn.status)) { turn.status = 'cancelled'; delete turn.progress; turn.progressText = ''; pending.delete(turn.id); }
      return send(200, turn);
    }
    if (path === '/api/search' && request.method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase();
      return send(200, { results: url.searchParams.get('spaceId') === fixturePage.spaceId ? [...pages.values()].filter(page => page.title.toLocaleLowerCase().includes(query) || page.content.toLocaleLowerCase().includes(query)).map(page => ({ page: { id: page.id, title: page.title, spaceId: page.spaceId } })) : [] });
    }
    const pagePath = path.match(/^\/api\/pages\/([^/]+)$/u);
    if (pagePath) {
      const page = pages.get(pagePath[1]);
      if (!page) return send(404, { message: 'Page not found' });
      if (request.method === 'GET') return send(200, page);
      if (request.method === 'PATCH') {
        if (input.expectedUpdatedAt && input.expectedUpdatedAt !== page.updatedAt) return send(409, { message: 'Page version conflict' });
        if (typeof input.title === 'string') page.title = input.title;
        if (typeof input.content === 'string') page.content = input.content;
        page.updatedAt = nextVersion(page.updatedAt); return send(200, page);
      }
      return send(405, { message: 'Unsupported fixture method' });
    }
    const notePath = path.match(/^\/api\/spaces\/([^/]+)\/pages\/([^/]+)\/notes(?:\/([^/]+))?$/u);
    if (notePath) {
      if (notePath[1] !== fixturePage.spaceId || !pages.has(notePath[2])) return send(404, { message: 'Page not found' });
      if (request.method === 'GET') return send(200, { notes: notes.filter(note => note.pageId === notePath[2]).map(noteDto), canCreate: true });
      if (request.method === 'POST' && !notePath[3]) {
        let note = notes.find(note => note.pageId === notePath[2] && note.author.id === fixtureUser.id && note.clientNoteId === input.clientNoteId);
        if (!note) { const createdAt = now(); note = { id: randomUUID(), spaceId: fixturePage.spaceId, pageId: notePath[2], author: { type: 'user', ...fixtureUser }, clientNoteId: input.clientNoteId, body: input.body, target: input.target, status: input.status ?? 'pending', taskId: input.taskId, createdAt, updatedAt: createdAt }; notes.push(note); }
        return send(201, noteDto(note));
      }
      const note = notes.find(note => note.id === notePath[3] && note.pageId === notePath[2]);
      if (!note) return send(404, { message: 'Note not found' });
      if (note.author.id !== fixtureUser.id) return send(403, { message: 'Only the author can edit' });
      if (input.expectedUpdatedAt !== note.updatedAt) return send(409, { message: 'Note version conflict' });
      if (request.method === 'PATCH') { for (const key of ['body', 'target', 'status', 'taskId']) if (key in input) note[key] = input[key]; note.updatedAt = nextVersion(note.updatedAt); return send(200, noteDto(note)); }
      if (request.method === 'DELETE') { notes.splice(notes.indexOf(note), 1); return send(200, { deleted: true }); }
    }
    if (path.endsWith('/content-tree')) return send(200, { treeRevision: '1', items: [] });
    if (path.includes('templates')) return send(200, { items: [], templates: [], capabilities: { canManage: false } });
    if (path.startsWith('/api/knowledge/related/') || path.endsWith('/markdown/resolve')) return send(200, []);
    return send(404, { message: `Unsupported fixture route: ${request.method} ${path}` });
  } catch { return send(400, { message: 'Malformed fixture request' }); }
});
const io = new Server(server);
io.of('/collaboration').on('connection', socket => {
  socket.on('join-page', () => socket.emit('active-users', []));
});
server.listen(5183, '127.0.0.1', () => process.stdout.write('Agent chat fixture API: http://127.0.0.1:5183 (synthetic only)\n'));
