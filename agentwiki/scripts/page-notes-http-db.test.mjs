import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';
import { assertTestRedisAvailable, resolveTestRedisTarget } from './e2e-safety.mjs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const database = process.env.COLLABORATION_TEST_DATABASE_URL;

test('shared page notes persist across human and MCP identities with live page authorization', {
  skip: !database && 'COLLABORATION_TEST_DATABASE_URL is required', timeout: 180_000,
}, async t => {
  const redis = assertTestRedisAvailable(resolveTestRedisTarget(process.env.TEST_REDIS_URL, { enabled: true }));
  await withCollaborationTestDatabase(database, async ({ databaseUrl }) => {
    const storage = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-notes-'));
    let app, client;
    try {
      Object.assign(process.env, {
        NODE_ENV: 'test', PROCESS_ROLE: 'api', DATABASE_URL: databaseUrl, REDIS_URL: redis.url,
        LOCAL_SYNC_PACKAGE_VERSION: '0.13.0',
        JWT_SECRET: `notes-http-${randomUUID()}-${randomUUID()}`,
        AGENTWIKI_SERVER_PEPPER: `notes-http-${randomUUID()}`,
        AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
        ATTACHMENT_STORAGE_PATH: storage, ATTACHMENT_MIN_FREE_BYTES: '1',
      });
      const { Test } = require('@nestjs/testing');
      const { ValidationPipe } = require('@nestjs/common');
      const { HttpAdapterHost } = require('@nestjs/core');
      const { AppModule } = require('./dist/app.module.js');
      const { PrismaService } = require('./dist/database/prisma.service.js');
      const { AllExceptionsFilter } = require('./dist/core/filters/all-exceptions.filter.js');
      require('./dist/bigint-json.js').installBigIntJsonSerialization();
      app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
      await app.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
      process.env.PUBLIC_API_URL = base;
      const db = app.get(PrismaService);
      const request = async (path, { token, method = 'GET', body, expected = [200, 201] } = {}) => {
        const response = await fetch(`${base}${path}`, {
          method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
        });
        const text = await response.text();
        assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status} ${text.slice(0, 500)}`);
        return text ? JSON.parse(text) : null;
      };
      const register = async name => {
        const nonce = randomUUID();
        const account = await request('/auth/register', { method: 'POST', body: { name, email: `${nonce}@example.test`, password: `Notes-${nonce}!` } });
        return { ...account.user, token: account.access_token };
      };
      const owner = await register('笔记作者'), reader = await register('评审成员'), outsider = await register('无权限成员');
      const space = await request('/spaces', { method: 'POST', token: owner.token, body: { name: '共享笔记验收' } });
      await request(`/spaces/${space.id}/members`, { method: 'POST', token: owner.token, body: { email: reader.email, role: 'viewer' } });
      const tree = await request(`/spaces/${space.id}/content-tree`, { token: owner.token });
      const createdPage = await request('/pages', { method: 'POST', token: owner.token, body: { title: '共享笔记', content: '# 协作\n\n需要明确验收条件。', spaceId: space.id, expectedTreeRevision: tree.treeRevision } });
      const page = await db.page.findUniqueOrThrow({ where: { id: createdPage.id } });
      const sourceBefore = { content: page.content, updatedAt: page.updatedAt.toISOString() };
      const path = `/spaces/${space.id}/pages/${page.id}/notes`;
      const from = page.content.indexOf('验收条件');
      const target = { kind: 'selection', from, to: from + 4, quote: '验收条件', prefix: page.content.slice(0, from), suffix: '。', baseUpdatedAt: page.updatedAt.toISOString() };
      const payload = { clientNoteId: randomUUID(), body: '补充可验证的验收条件', target };
      let own, viewerNote, agentNote;
      await t.test('one authoritative note is visible to another member and idempotent migration does not duplicate it', async () => {
        own = await request(path, { token: owner.token, method: 'POST', body: payload });
        assert.deepEqual(own.author, { type: 'user', id: owner.id, name: '笔记作者' });
        const retry = await request(path, { token: owner.token, method: 'POST', body: payload });
        assert.equal(retry.id, own.id);
        const list = await request(path, { token: reader.token });
        assert.equal(list.canCreate, true); assert.equal(list.notes.length, 1);
        assert.equal(list.notes[0].id, own.id); assert.equal(list.notes[0].canEdit, false);
        assert.equal(list.notes[0].clientNoteId, undefined);
        viewerNote = await request(path, { token: reader.token, method: 'POST', body: { ...payload, clientNoteId: randomUUID(), body: '只读成员也可以参与批注' } });
        assert.equal(viewerNote.author.id, reader.id);
        assert.equal((await request(path, { token: owner.token })).notes.length, 2);
      });
      await t.test('ownership, stale edits, spoofed authors and inaccessible pages are enforced by HTTP', async () => {
        await request(`${path}/${own.id}`, { token: reader.token, method: 'PATCH', body: { body: '冒用作者', expectedUpdatedAt: own.updatedAt }, expected: [403] });
        await request(`${path}/${own.id}`, { token: reader.token, method: 'DELETE', body: { expectedUpdatedAt: own.updatedAt }, expected: [403] });
        await request(path, { token: outsider.token, expected: [403, 404] });
        await request(path, { token: outsider.token, method: 'POST', body: payload, expected: [403, 404] });
        await request(path, { token: owner.token, method: 'POST', body: { ...payload, authorId: reader.id }, expected: [400] });
        const firstVersion = own.updatedAt;
        own = await request(`${path}/${own.id}`, { token: owner.token, method: 'PATCH', body: { body: '已补充验收条件', expectedUpdatedAt: firstVersion } });
        assert.notEqual(own.updatedAt, firstVersion);
        await request(`${path}/${own.id}`, { token: owner.token, method: 'PATCH', body: { body: '过期覆盖', expectedUpdatedAt: firstVersion }, expected: [409] });
        assert.equal((await request(path, { token: reader.token })).notes.find(n => n.id === own.id).body, '已补充验收条件');
      });
      const agent = await request('/agents', { token: owner.token, method: 'POST', body: { name: '验收 Agent' } });
      const installation = await request(`/agents/${agent.id}/local-sync-installations`, { token: owner.token, method: 'POST', body: { spaceId: space.id, role: 'editor', pluginVersion: '0.13.0' } });
      const { apiKey } = await request('/integrations/local-sync/exchange', { method: 'POST', body: { code: installation.code } });
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
      client = new Client({ name: 'page-notes-db-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } }));
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, JSON.stringify(result.content));
        return JSON.parse(result.content.find(part => part.type === 'text').text);
      };
      await t.test('real MCP tool discovery and calls share human and Agent notes with distinct authors', async () => {
        const tools = await client.listTools();
        for (const name of ['list_page_notes', 'create_page_note', 'update_page_note', 'delete_page_note']) assert.ok(tools.tools.some(tool => tool.name === name));
        const args = { spaceId: space.id, pageId: page.id };
        assert.equal((await call('list_page_notes', args)).notes.length, 2);
        agentNote = await call('create_page_note', { ...args, ...payload, clientNoteId: randomUUID(), body: 'Agent 已复核验收条件' });
        assert.deepEqual(agentNote.author, { type: 'agent', id: agent.id, name: '验收 Agent' });
        const humanRead = (await request(path, { token: reader.token })).notes.find(note => note.id === agentNote.id);
        assert.equal(humanRead.body, agentNote.body); assert.equal(humanRead.canEdit, false);
        agentNote = await call('update_page_note', { ...args, noteId: agentNote.id, expectedUpdatedAt: agentNote.updatedAt, body: 'Agent 完成复核' });
        assert.equal((await request(path, { token: owner.token })).notes.find(note => note.id === agentNote.id).body, 'Agent 完成复核');
      });
      await t.test('page title changes and human/Agent note writes can run concurrently without deadlock', async () => {
        const tree = await request(`/spaces/${space.id}/content-tree`, { token: owner.token });
        let concurrentPage = await request('/pages', { method: 'POST', token: owner.token, body: { title: '并发笔记验收', content: page.content, spaceId: space.id, expectedTreeRevision: tree.treeRevision } });
        const scope = { spaceId: space.id, pageId: concurrentPage.id };
        for (let i = 0; i < 3; i++) {
          const currentTree = await request(`/spaces/${space.id}/content-tree`, { token: owner.token });
          const [renamed] = await Promise.all([
            request(`/pages/${concurrentPage.id}`, { token: owner.token, method: 'PATCH', body: { title: `并发笔记验收 ${i + 1}`, expectedUpdatedAt: concurrentPage.updatedAt, expectedTreeRevision: currentTree.treeRevision } }),
            request(`/spaces/${space.id}/pages/${concurrentPage.id}/notes`, { token: reader.token, method: 'POST', body: { ...payload, clientNoteId: randomUUID() } }),
            call('create_page_note', { ...scope, ...payload, clientNoteId: randomUUID() }),
          ]);
          concurrentPage = renamed;
        }
        assert.equal((await call('list_page_notes', scope)).notes.length, 6);
      });
      await t.test('role downgrade and revoked membership apply to the next REST and MCP read/write', async () => {
        await request(`/agents/${agent.id}/grants/${space.id}`, { method: 'PUT', token: owner.token, body: { role: 'reader' } });
        assert.equal((await call('list_page_notes', { spaceId: space.id, pageId: page.id })).notes.length, 3);
        const denied = await client.callTool({ name: 'create_page_note', arguments: { spaceId: space.id, pageId: page.id, ...payload, clientNoteId: randomUUID() } });
        assert.equal(denied.isError, true);
        await db.spaceMember.delete({ where: { userId_spaceId: { userId: reader.id, spaceId: space.id } } });
        await request(path, { token: reader.token, expected: [403, 404] });
        await db.agentGrant.delete({ where: { agentId_spaceId: { agentId: agent.id, spaceId: space.id } } });
        assert.equal((await client.callTool({ name: 'list_page_notes', arguments: { spaceId: space.id, pageId: page.id } })).isError, true);
      });
      await t.test('notes do not mutate Markdown, deletion stays deleted across migration retries', async () => {
        const finalPage = await db.page.findUniqueOrThrow({ where: { id: page.id } });
        assert.deepEqual({ content: finalPage.content, updatedAt: finalPage.updatedAt.toISOString() }, sourceBefore);
        await request(`${path}/${own.id}`, { token: owner.token, method: 'DELETE', body: { expectedUpdatedAt: own.updatedAt } });
        assert.equal((await request(path, { token: owner.token })).notes.some(note => note.id === own.id), false);
        await request(path, { token: owner.token, method: 'POST', body: payload, expected: [409] });
      });
    } finally {
      try { await client?.close(); }
      finally {
        try { await app?.close(); }
        finally { await rm(storage, { recursive: true, force: true }); }
      }
    }
  });
});
