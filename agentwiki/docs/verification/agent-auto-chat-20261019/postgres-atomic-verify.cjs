const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/apps/server/package.json');
const { PrismaClient } = req('@prisma/client');
const { Test } = req('@nestjs/testing');
const { WorkerModule } = req('./dist/worker.module');
const { PrismaService } = req('./dist/database/prisma.service');
const { AuthorizationService } = req('./dist/core/authorization/authorization.service');
const { SpaceRevisionWriterService } = req('./dist/core/sync/space-revision-writer.service');
const { ContentTreeService } = req('./dist/content-tree/content-tree.service');
const { AssistDocumentWriter } = req('./dist/assist/assist-document-writer');
const { AssistSessionService } = req('./dist/assist/assist-session.service');
const { AssistQueue } = req('./dist/assist/assist.queue');
const { captureDirectory } = req('./dist/assist/assist-directory.context');
const destination = new URL(process.env.DATABASE_URL);
assert.equal(destination.hostname, '127.0.0.1', 'This verification only runs against its isolated local database');
assert.equal(destination.pathname, '/agentwiki_auto_chat_20261019_02', 'Unexpected verification database');
const db = new PrismaClient();
const tag = 'atomic-' + Date.now();
const userId = tag + '-user', spaceId = tag + '-space';
const report = { database: 'isolated local PostgreSQL', fixtureSpace: spaceId, startedAt: new Date().toISOString(), checks: [] };
let moduleRef, auth, revisions, writer, sessions, pageId;
const record = (name, evidence = {}) => { report.checks.push({ name, passed: true, ...evidence }); console.log(JSON.stringify({ name, passed: true })); };
const rootContext = { pageId: null, references: [], noteIds: [], directory: { folderId: null, title: 'Root', recursive: true, documents: [] } };
const transaction = fn => db.$transaction(async tx => { await auth.lockLiveHumanPrincipal(tx, { userId }); const locked = await revisions.lockSpace(tx, spaceId); return fn(locked); }, { timeout: 120000 });
const state = async () => ({ pages: await db.page.findMany({ where: { spaceId }, select: { id: true, content: true, title: true, updatedAt: true }, orderBy: { id: 'asc' } }), versions: await db.pageVersion.count({ where: { page: { spaceId } } }), revisions: await db.spaceKnowledgeRevision.count({ where: { spaceId } }), tree: (await db.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision.toString() });
async function runningTurn(result, options = {}) {
  const runner = { run: async input => typeof result === 'function' ? result(input) : result };
  const q = new AssistQueue(options.database || db, { get: () => undefined }, runner, {}, auth, revisions, sessions, options.writer || writer);
  const session = await sessions.create(spaceId, userId, 'Atomic verification');
  const page = await db.page.findUniqueOrThrow({ where: { id: pageId } });
  const directory = await captureDirectory(db, spaceId, { folderId: null });
  const task = await db.assistTask.create({ data: { sessionId: session.id, spaceId, requestedByUserId: userId, clientRequestId: tag + '-' + report.checks.length + '-' + Math.random(), pageId, pageSnapshot: { title: page.title, content: page.content, updatedAt: page.updatedAt.toISOString() }, context: { pageId, references: [], noteIds: [], directory }, mode: 'auto', intent: 'Create or update the requested document', status: 'running', leaseOwner: q.workerId, leaseExpiresAt: new Date(Date.now() + (options.leaseMs || 60000)) } });
  return { q, task, run: () => q.processOne({ ...task, leaseExpiresAtMs: task.leaseExpiresAt.getTime() }), read: () => db.assistTask.findUniqueOrThrow({ where: { id: task.id } }) };
}
async function main() {
  process.env.PROCESS_ROLE = 'api';
  const constraints = await db.$queryRaw`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'AssistTask_mode_check'`;
  assert.ok(constraints[0].definition.includes("'auto'"));
  record('deployed migration permits automatic mode in the real database constraint');
  moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(PrismaService).useValue(db).compile();
  auth = moduleRef.get(AuthorizationService); revisions = moduleRef.get(SpaceRevisionWriterService); sessions = moduleRef.get(AssistSessionService);
  writer = new AssistDocumentWriter(auth, moduleRef.get(ContentTreeService), { indexPage: async () => {} }, { enqueue() {} });
  await db.user.create({ data: { id: userId, email: tag + '@example.test', type: 'human' } });
  await db.space.create({ data: { id: spaceId, name: 'Atomic auto validation', slug: spaceId, members: { create: { userId, role: 'owner' } } } });
  const seed = await transaction(tx => writer.write(tx, { id: 'seed', pageId: null, pageSnapshot: null, spaceId, requestedByUserId: userId }, rootContext, { action: 'create', title: 'Seed', summary: 'Saved', changes: 'ORIGINAL' })); pageId = seed.pageId;
  {
    const before = await state(); const turn = await runningTurn({ action: 'answer', summary: 'A chat response' }); await turn.run(); assert.equal((await turn.read()).status, 'done'); assert.deepEqual(await state(), before); record('answer does not mutate pages, versions, or revisions');
  }
  {
    const before = await state(); const turn = await runningTurn({ action: 'create', title: 'Created atomically', summary: 'Saved', changes: 'CREATED' }); await turn.run(); const done = await turn.read(); assert.equal(done.status, 'done'); const after = await state(); assert.equal(after.pages.length, before.pages.length + 1); assert.equal(after.revisions, before.revisions + 1); assert.equal(+after.tree, +before.tree + 1); const doc = done.result.document; assert.equal(doc.operation, 'created'); assert.equal((await db.page.findUniqueOrThrow({ where: { id: doc.pageId } })).content, 'CREATED'); record('create and completion receipt commit together with canonical tree revision', { turnId: turn.task.id, pageId: doc.pageId });
  }
  {
    const before = await state(); const turn = await runningTurn({ action: 'update', summary: 'Saved', changes: 'UPDATED' }); await turn.run(); const done = await turn.read(); const after = await state(); assert.equal(done.status, 'done'); assert.equal(after.versions, before.versions + 1); assert.equal(after.revisions, before.revisions + 1); assert.equal(after.tree, before.tree); assert.equal((await db.page.findUniqueOrThrow({ where: { id: pageId } })).content, 'UPDATED'); assert.equal(done.result.document.pageId, pageId); record('update saves previous version and advances content revision without moving page');
  }
  {
    const before = await state(); const failingWriter = { write: async (...args) => { await writer.write(...args); throw new Error('injected after complete page mutation'); }, afterCommit: async () => { throw new Error('must not run'); } }; const turn = await runningTurn({ action: 'create', title: 'Must roll back', summary: 'Saved', changes: 'ROLLBACK' }, { writer: failingWriter }); await turn.run(); assert.equal((await turn.read()).status, 'failed'); assert.deepEqual(await state(), before); record('failure after page and tree mutations rolls back all document writes and done transition');
  }
  {
    const turn = await runningTurn(async () => { const page = await db.page.findUniqueOrThrow({ where: { id: pageId } }); await transaction(tx => writer.write(tx, { ...turn.task, pageSnapshot: { updatedAt: page.updatedAt.toISOString() } }, { ...rootContext, pageId }, { action: 'update', summary: 'Other editor saved', changes: 'CONCURRENT EDIT' })); return { action: 'update', summary: 'Saved', changes: 'STALE OVERWRITE' }; }); await turn.run(); assert.equal((await turn.read()).status, 'failed'); assert.equal((await db.page.findUniqueOrThrow({ where: { id: pageId } })).content, 'CONCURRENT EDIT'); record('page CAS rejects stale automatic output after concurrent save');
  }
  {
    const before = await state(); const turn = await runningTurn(async () => { await sessions.cancel(turn.task.id, userId); return { action: 'create', title: 'Cancelled page', summary: 'Saved', changes: 'CANCELLED' }; }); await turn.run(); assert.equal((await turn.read()).status, 'cancelled'); assert.deepEqual(await state(), before); record('cancellation wins against late model result without a page write');
  }
  {
    const before = await state(); const turn = await runningTurn({ action: 'create', title: 'Expired page', summary: 'Saved', changes: 'EXPIRED' }); await db.assistTask.update({ where: { id: turn.task.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }); await turn.run(); assert.deepEqual(await state(), before); assert.notEqual((await turn.read()).status, 'done'); record('expired lease cannot publish a document');
  }
  {
    const before = await state(); const turn = await runningTurn(async () => { await db.spaceMember.update({ where: { userId_spaceId: { userId, spaceId } }, data: { role: 'viewer' } }); return { action: 'update', summary: 'Saved', changes: 'UNAUTHORIZED' }; }); await turn.run(); assert.equal((await turn.read()).status, 'failed'); assert.deepEqual(await state(), before); await db.spaceMember.update({ where: { userId_spaceId: { userId, spaceId } }, data: { role: 'owner' } }); record('live role downgrade prevents document publication');
  }
  {
    const before = await state(); const turn = await runningTurn({ action: 'create', title: 'Single winner', summary: 'Saved', changes: 'ONCE' }); await Promise.all([turn.run(), turn.run()]); const done = await turn.read(); assert.equal(done.status, 'done'); const after = await state(); assert.equal(after.pages.length, before.pages.length + 1); assert.equal(after.revisions, before.revisions + 1); await turn.run(); assert.deepEqual(await state(), after); const retry = await sessions.send(turn.task.sessionId, userId, { clientRequestId: turn.task.clientRequestId, mode: 'auto', intent: 'Repeated request', pageId }); assert.equal(retry.id, turn.task.id); assert.deepEqual(await state(), after); record('concurrent completion, worker retry and repeated request publish exactly once');
  }
  {
    const before = await state(); let receiptWritten = false;
    const delayedDatabase = { assistTask: db.assistTask, $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) { if (key !== 'assistTask') return target[key]; return new Proxy(target.assistTask, { get(delegate, operation) { if (operation !== 'update') return delegate[operation]; return async input => { const result = await delegate.update(input); receiptWritten = true; await new Promise(resolve => setTimeout(resolve, 400)); return result; }; } }); } })), options) };
    const turn = await runningTurn({ action: 'create', title: 'Late receipt rollback', summary: 'Saved', changes: 'LATE' }, { database: delayedDatabase, leaseMs: 250 });
    await turn.run(); assert.equal(receiptWritten, true); assert.notEqual((await turn.read()).status, 'done'); assert.deepEqual(await state(), before);
    record('lease expiry while final receipt UPDATE is pending rolls back page, revision, and receipt');
  }
  report.finishedAt = new Date().toISOString(); report.checkCount = report.checks.length; fs.mkdirSync(process.cwd() + '/docs/verification/agent-auto-chat-20261019', { recursive: true }); fs.writeFileSync(process.cwd() + '/docs/verification/agent-auto-chat-20261019/postgres-atomic-receipt.json', JSON.stringify(report, null, 2)); console.log('POSTGRES_ATOMIC_CHECKS_PASSED');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => { await db.assistTask.updateMany({ where: { spaceId, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } }).catch(() => {}); await moduleRef?.close(); await db.$disconnect(); });
