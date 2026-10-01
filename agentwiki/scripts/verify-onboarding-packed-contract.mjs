import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the installed npm artifacts against real server services. Only storage,
// Agent credential persistence and remote MCP verification use bounded test adapters.
export async function verifyOnboardingPackedContract({ root, installDirectory, version }) {
  const requireServer = createRequire(join(root, 'apps/server/package.json'));
  const { OnboardBootstrapService } = requireServer('./dist/onboard/onboard-bootstrap.service.js');
  const { LocalSyncInstallationService } = requireServer('./dist/core/agent/local-sync-installation.service.js');
  const { hashServerPlan: serverHash } = requireServer('./dist/onboard/onboard.types.js');
  const protocol = requireServer('@neomei/agentwiki-sync-protocol');
  const { plainToInstance } = requireServer('class-transformer');
  const { validate } = requireServer('class-validator');
  const { BootstrapDto } = requireServer('./dist/onboard/onboard.dto.js');
  const localRoot = join(installDirectory, 'node_modules/@neomei/agentwiki-local-sync/dist');
  const { OnboardingClient } = await import(pathToFileURL(join(localRoot, 'onboarding/client.js')));
  const { hashServerPlan: clientHash } = await import(pathToFileURL(join(localRoot, 'onboarding/plan-hash.js')));
  const { AgentWikiClient } = await import(pathToFileURL(join(localRoot, 'agentwiki-client.js')));
  const { assertConfirmedBootstrap, installExchangedGateway } = await import(pathToFileURL(join(localRoot, 'onboarding/install.js')));
  const publisherScopes = [
    'collaboration:execute', 'collaboration:read', 'folders:delete', 'folders:read', 'folders:write',
    'graph:read', 'graph:write', 'pages:read', 'pages:write', 'review:auto-publish', 'review:read',
    'runs:read', 'runs:write', 'sources:read', 'sources:write', 'spaces:read',
  ];
  const storage = new Map();
  const redis = {
    getStrict: async (key) => storage.get(key) ?? null,
    setStrict: async (key, value) => { storage.set(key, value); },
    setOnce: async (key, value) => { if (storage.has(key)) return false; storage.set(key, value); return true; },
    deleteStrict: async (key) => Number(storage.delete(key)),
    deleteIfValueMatches: async (key, value) => storage.get(key) === value && storage.delete(key),
    incrementWithWindow: async () => 1,
  };
  let baseUrl;
  const config = { get: (key) => ({ LOCAL_SYNC_PACKAGE_VERSION: version, JWT_SECRET: 'packed-contract-test-only-secret', PUBLIC_API_URL: baseUrl, NODE_ENV: 'test' })[key] };
  const agents = {
    assertCanIssueConnection: async () => {},
    exchangeConnectionIntent: async ({ agentId, role }) => ({ id: 'credential-test', grantId: 'grant-test', agentId, role, scopes: protocol.scopesForAgentAccessRole(role), revokedAt: null }),
  };
  const installations = new LocalSyncInstallationService(redis, agents, config, { record: async () => {} });
  let record;
  const bootstrapStore = {
    create: async ({ data }) => (record = { id: 'bootstrap-test', ...data }),
    updateMany: async ({ data }) => { record = { ...record, ...data }; return { count: 1 }; },
    findUnique: async () => record,
  };
  const prisma = {
    onboardingBootstrap: bootstrapStore,
    onboardingDeviceSession: { updateMany: async () => ({ count: 1 }) },
    $transaction: async (fn) => fn({
      onboardingBootstrap: bootstrapStore,
      space: { create: async ({ data }) => ({ id: 'space-test', name: data.name }) },
      agent: { create: async ({ data }) => ({ id: 'agent-test', name: data.name }) },
    }),
  };
  const bootstrap = new OnboardBootstrapService(prisma, redis, installations, config);
  const principal = { sessionId: 'session-packed-test', userId: 'owner-test', packageVersion: version, purpose: 'full-onboarding', requestedCapabilities: ['bootstrap:space', 'bootstrap:agent', 'bootstrap:installation'] };
  const plan = { space: { mode: 'create', name: 'Packed publisher Space' }, agentName: 'Packed publisher', role: 'publisher', packageVersion: version };
  const requests = [];
  const http = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      let result;
      if (req.url === '/api/onboard/bootstrap') {
        requests.push(body);
        const dto = plainToInstance(BootstrapDto, body);
        const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length) { res.writeHead(400); res.end(JSON.stringify({ code: 'INVALID_PLAN' })); return; }
        result = await bootstrap.bootstrap(principal, req.headers['idempotency-key'], dto.serverPlan, dto.serverPlanHash);
      } else if (req.url === '/api/integrations/local-sync/exchange') {
        result = await installations.exchange(body.code, '127.0.0.1');
      } else throw new Error('unexpected route');
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: error.businessCode ?? 'FAILED' })); }
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${http.address().port}/api`;
  try {
    assert.equal(clientHash(plan), serverHash(plan), 'packed and server publisher scopes must yield the same hash');
    const client = new OnboardingClient();
    const result = await client.bootstrap({ serverBaseUrl: baseUrl, onboardingToken: 'test-only-token', idempotencyKey: 'packed-publisher-key', serverPlan: plan, serverPlanHash: clientHash(plan) });
    assert.deepEqual(requests[0].serverPlan, plan, 'send the original raw plan');
    assert.equal(Object.hasOwn(requests[0].serverPlan, 'scopes'), false);
    assert.deepEqual(result.grant.scopes, publisherScopes);
    assertConfirmedBootstrap(result, plan);
    for (const scopes of [publisherScopes.slice(1), [...publisherScopes, 'memory:read'], [...publisherScopes].reverse(), [...publisherScopes.slice(1), publisherScopes[1]]]) {
      assert.throws(() => assertConfirmedBootstrap({ ...result, grant: { role: 'publisher', scopes } }, plan), { code: 'PACKAGE_INTEGRITY_FAILED' });
    }
    for (const changed of [{ ...plan, role: 'editor' }, { ...plan, agentName: 'tampered' }]) {
      await assert.rejects(client.bootstrap({ serverBaseUrl: baseUrl, onboardingToken: 'test-only-token', idempotencyKey: 'tampered-publisher-key', serverPlan: changed, serverPlanHash: clientHash(plan) }), (error) => error.code === 'REMOTE_UNAVAILABLE' && /ONBOARDING_PLAN_HASH_MISMATCH/u.test(error.message));
    }
    const injected = await fetch(`${baseUrl}/onboard/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'injected-scopes-key' }, body: JSON.stringify({ serverPlan: { ...plan, scopes: publisherScopes }, serverPlanHash: clientHash(plan) }) });
    assert.equal(injected.status, 400, 'strict DTO rejects caller supplied scopes');
    const code = await installations.create('owner-test', 'agent-test', 'space-test', 'publisher', version, baseUrl);
    const exchanges = await Promise.all([new AgentWikiClient().exchange(baseUrl, result.installation.code), new AgentWikiClient().exchange(baseUrl, code.code)]);
    for (const exchange of exchanges) {
      assert.deepEqual(exchange.scopes, publisherScopes);
      let saved;
      const input = { home: join(installDirectory, 'home'), client: 'codex', connectionId: 'publisher-test', expectedConfigHash: 'test-config-hash', expectedAgentId: 'agent-test', expectedSpaceId: 'space-test', expectedRole: 'publisher', expectedScopes: publisherScopes, expectedPluginVersion: version, exchange };
      const deps = { loadExisting: async () => null, archive: async () => null, initialize: async () => {}, saveConnection: async (_home, connection) => { saved = connection; }, installSkill: async () => {}, installClient: async () => ({ backupPath: 'test-backup', rollback: async () => {} }), verify: async () => ({ ok: true, errors: [], manifestHash: 'test-manifest' }), verifyAccess: async () => {}, restore: async () => {} };
      await installExchangedGateway(input, deps);
      assert.equal(saved.pluginVersion, version);
      for (const tampered of [{ ...exchange, scopes: [...publisherScopes, 'memory:write'] }, { ...exchange, scopes: publisherScopes.slice(1) }, { ...exchange, role: 'editor' }, { ...exchange, spaceId: 'wrong' }, { ...exchange, pluginVersion: '0.10.0' }]) {
        await assert.rejects(installExchangedGateway({ ...input, exchange: tampered }, deps), { code: 'PACKAGE_INTEGRITY_FAILED' });
      }
    }
    return { publisherPaths: ['device-bootstrap', 'one-time-code'], scopes: publisherScopes.length, tamperRejected: true, rawServerPlan: true };
  } finally { await new Promise((resolve) => http.close(resolve)); }
}
