// Local fixture only; this is a resolver/blob transport stand-in, not an authorization test.
// Run alongside Vite with AGENTWIKI_DEV_API_ORIGIN=http://127.0.0.1:5181.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const image = await readFile(new URL('../../public/docs/architecture-zh.jpg', import.meta.url));
http.createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/spaces/editor-image-fixture/markdown/resolve') {
    let body = '';
    for await (const chunk of request) body += chunk;
    try {
      const { references, sourcePageId } = JSON.parse(body);
      if (sourcePageId !== 'image-fixture-page' || !Array.isArray(references)) throw new Error('Invalid fixture request');
      const items = references.map(ref => ['test.jpg', 'assets/test.jpg'].includes(ref.target)
        ? { key: ref.key, status: 'resolved', kind: 'attachment', attachmentId: 'fixture-image', displayName: 'test.jpg', mimeType: 'image/jpeg', width: 640, height: 360 }
        : { key: ref.key, status: 'unresolved' });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(items));
    } catch { response.writeHead(400); response.end(); }
    return;
  }
  if (request.method === 'GET' && request.url === '/api/attachments/fixture-image/content') {
    response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    response.end(image);
    return;
  }
  response.writeHead(404); response.end();
}).listen(5181, '127.0.0.1', () => process.stdout.write('Image fixture API: http://127.0.0.1:5181\n'));
