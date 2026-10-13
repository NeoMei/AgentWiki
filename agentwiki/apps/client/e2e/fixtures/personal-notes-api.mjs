// Isolated page/storage transport for real UI acceptance. No production authentication or Agent calls.
import http from 'node:http';
import { createRequire } from 'node:module';
import { fixturePage } from './personal-notes-data.mjs';
const requireServer = createRequire(new URL('../../../server/package.json', import.meta.url));
const { Server } = requireServer('socket.io');
let page = { ...fixturePage };
const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  let data;
  if (path === `/api/pages/${page.id}` && request.method === 'GET') data = page;
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
