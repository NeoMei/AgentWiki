// Isolated page/storage transport for real UI acceptance. No production authentication or Agent calls.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fixturePage } from './personal-notes-data.mjs';
const requireServer = createRequire(new URL('../../../server/package.json', import.meta.url));
const { Server } = requireServer('socket.io');
let page = { ...fixturePage };
const actors = {
  'personal-notes-user': { type: 'user', id: 'personal-notes-user', name: '本地演示' },
  'other-fixture-user': { type: 'user', id: 'other-fixture-user', name: '评审成员' },
};
const targetFor = (quote) => {
  const from = page.content.indexOf(quote);
  return { kind: 'selection', from, to: from + quote.length, quote, prefix: page.content.slice(Math.max(0, from - 48), from), suffix: page.content.slice(from + quote.length, from + quote.length + 48), baseUpdatedAt: page.updatedAt };
};
const seed = (id, author, quote, body) => ({ id, author, spaceId: page.spaceId, pageId: page.id, body, target: targetFor(quote), status: 'pending', createdAt: page.createdAt, updatedAt: page.updatedAt });
const notes = [
  seed('reviewer-note', actors['other-fixture-user'], '明确的验收条件', '建议补充可复现的验收步骤。'),
  seed('agent-note', { type: 'agent', id: 'fixture-review-agent', name: '代码审查 Agent' }, '失败原因和修复反馈', '已检查回归项，请在测试报告中补充原始复现步骤。'),
];
const notesPath = `/api/spaces/${page.spaceId}/pages/${page.id}/notes`;
const present = (note, actor) => {
  const own = note.author.type === 'user' && note.author.id === actor.id;
  return { ...note, clientNoteId: own ? note.clientNoteId : undefined, canEdit: own };
};
const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  let data;
  if (path === notesPath || path.startsWith(`${notesPath}/`)) {
    const actor = actors[request.headers.authorization?.replace(/^Bearer /, '')];
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (!actor) { send(401, { message: 'Unknown synthetic fixture account' }); return; }
    if (request.method === 'GET') data = { notes: notes.map(note => present(note, actor)), canCreate: true };
    else {
      let raw = ''; for await (const part of request) raw += part;
      const input = JSON.parse(raw || '{}');
      if (request.method === 'POST' && path === notesPath) {
        let note = notes.find(note => note.author.id === actor.id && note.clientNoteId === input.clientNoteId);
        if (!note) {
          const now = new Date().toISOString();
          note = { id: randomUUID(), spaceId: page.spaceId, pageId: page.id, author: actor, clientNoteId: input.clientNoteId, body: input.body, target: input.target, status: input.status ?? 'pending', taskId: input.taskId, createdAt: now, updatedAt: now };
          notes.push(note);
        }
        data = present(note, actor);
      } else if (request.method === 'PATCH') {
        const note = notes.find(note => note.id === path.slice(notesPath.length + 1));
        if (!note) { send(404, { message: 'Note not found' }); return; }
        if (note.author.type !== 'user' || note.author.id !== actor.id) { send(403, { message: 'Only the author can edit' }); return; }
        if (note.updatedAt !== input.expectedUpdatedAt) { send(409, { message: 'Version conflict' }); return; }
        for (const key of ['body', 'target', 'status', 'taskId']) if (key in input) note[key] = input[key];
        note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1)).toISOString();
        data = present(note, actor);
      } else { send(405, { message: 'Unsupported fixture method' }); return; }
    }
  } else if (path === `/api/pages/${page.id}` && request.method === 'GET') data = page;
  else if (path === `/api/pages/${page.id}` && request.method === 'PATCH') {
    let raw = ''; for await (const part of request) raw += part;
    const update = JSON.parse(raw || '{}'); page = { ...page, title: update.title ?? page.title, content: update.content ?? page.content, updatedAt: new Date().toISOString() }; data = page;
  } else if (path.endsWith('/content-tree')) data = { treeRevision: '1', items: [] };
  else if (path.includes('templates')) data = { items: [], templates: [], capabilities: { canManage: false } };
  else if (path.startsWith('/api/knowledge/related/') || path === '/api/assist/sessions') data = [];
  else if (path.endsWith('/markdown/resolve')) data = [];
  else if (request.method === 'GET') data = [];
  else { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
});
const io = new Server(server);
io.of('/collaboration').on('connection', socket => {
  socket.on('join-page', () => socket.emit('active-users', []));
});
server.listen(5182, '127.0.0.1', () => process.stdout.write('Personal notes fixture API: http://127.0.0.1:5182\n'));
