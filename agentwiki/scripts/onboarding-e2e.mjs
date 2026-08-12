#!/usr/bin/env node
/** Real NDJSON onboarding E2E driver with disposable human/resources. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

const HARNESS_DEADLINE_MS = 5 * 60 * 1_000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const target = value('--target');
  if (!target) throw new Error('--target <url> is required');
  return {
    target,
    clientType: value('--client') ?? 'codex',
    cliFile: value('--cli-file'),
  };
}

export async function runOnboardingHarness(opts) {
  if (!opts.target) throw new Error('--target <url> is required');
  const environment = opts.env ?? process.env;
  const baseUrl = assertE2ETarget(opts.target, environment, 'AGENTWIKI_E2E');
  const clientType = opts.clientType ?? 'codex';
  if (!['codex', 'claude', 'opencode'].includes(clientType)) throw new Error('unsupported --client');

  const root = await mkdtemp(join(tmpdir(), `agentwiki-onboard-${clientType}-`));
  const home = join(root, 'home');
  const source = join(root, 'source');
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'README.md'), '# Disposable onboarding fixture\n\nA temporary E2E knowledge source.\n');

  const fixture = { spaceId: null, agentId: null, userId: null };
  const auth = { token: null };
  let child;
  let primaryError;
  try {
    child = (opts.spawnImpl ?? defaultSpawn)({
      baseUrl,
      clientType,
      home,
      cliFile: opts.cliFile,
      environment,
    });
    const result = await driveProtocol(child, {
      baseUrl,
      clientType,
      sourcePaths: [source],
      fetchImpl: opts.fetchImpl ?? fetch,
      fixture,
      auth,
    });
    fixture.spaceId = result.report?.space?.id ?? null;
    fixture.agentId = result.report?.agent?.id ?? null;
    assertCompletion(result);
    return { sessionId: result.sessionId, report: result.report, fixture, home };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    terminateChild(child);
    if (auth.token) {
      const fetchImpl = opts.fetchImpl ?? fetch;
      await discoverFixture(baseUrl, auth.token, fixture, fetchImpl).catch(() => undefined);
      try {
        await cleanupFixture(fixture, async (kind, id) => {
          const route = kind === 'agent' ? `agents/${id}` : kind === 'space' ? `spaces/${id}` : `users/${id}`;
          const response = await fetchImpl(`${baseUrl}/${route}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` },
          });
          if (!response.ok && response.status !== 404) throw new Error(`${kind} cleanup returned ${response.status}`);
        });
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

async function discoverFixture(baseUrl, token, fixture, fetchImpl) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!fixture.agentId) {
    const response = await fetchImpl(`${baseUrl}/agents`, { headers });
    if (response.ok) {
      const body = await response.json();
      const agents = Array.isArray(body) ? body : body.data ?? [];
      fixture.agentId = agents.find((item) => String(item.name ?? '').startsWith('aw-e2e-'))?.id ?? null;
    }
  }
  if (!fixture.spaceId) {
    const response = await fetchImpl(`${baseUrl}/spaces`, { headers });
    if (response.ok) {
      const body = await response.json();
      const spaces = Array.isArray(body) ? body : body.data ?? [];
      fixture.spaceId = spaces.find((item) => String(item.name ?? '').startsWith('aw-e2e-'))?.id ?? null;
    }
  }
}

function defaultSpawn({ baseUrl, clientType, home, cliFile, environment }) {
  const args = ['onboard', '--server', baseUrl, '--protocol', 'ndjson'];
  const env = {
    ...environment, HOME: home, USERPROFILE: home,
    ...(cliFile ? { AGENTWIKI_E2E_CLI_FILE: resolve(cliFile) } : {}),
  };
  const detached = process.platform !== 'win32';
  if (cliFile) return spawn(process.execPath, [resolve(cliFile), ...args], { stdio: ['pipe', 'pipe', 'pipe'], env, detached });
  return spawn('npx', ['--yes', '@neomei/agentwiki-local-sync@0.3.4', ...args], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, AGENTWIKI_E2E_CLIENT: clientType }, detached,
  });
}

function terminateChild(child) {
  if (!child?.kill) return;
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* process already exited */ }
  }
  child.kill('SIGKILL');
}

async function driveProtocol(child, context) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let stderr = '';
    let sessionId = null;
    let settled = false;
    let authorizing = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    const timer = setTimeout(() => finish(new Error(`onboarding harness timed out after ${HARNESS_DEADLINE_MS}ms`)), HARNESS_DEADLINE_MS);
    child.stderr?.on('data', (data) => { stderr = (stderr + data.toString()).slice(-4000); });
    child.stdout?.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        sessionId = event.sessionId ?? sessionId;
        if (event.type === 'input_required') {
          sendInputReply(child, event.requestId, {
            spaceMode: 'create',
            spaceName: `aw-e2e-${Date.now()}-space`,
            agentName: `aw-e2e-${context.clientType}-agent`,
            permissionPreset: 'editor', approvalMode: 'always-review',
            clientType: context.clientType, sourcePaths: context.sourcePaths, sourceType: 'documents',
          });
        } else if (event.type === 'authorization_required' && !authorizing) {
          authorizing = true;
          authorizeDevice(context, event.userCode).catch((error) => finish(error));
        } else if (event.type === 'confirmation_required') {
          sendConfirmationReply(child, event.requestId, event.planHash);
        } else if (event.type === 'completed') {
          finish(null, { sessionId, report: event.report });
        } else if (event.type === 'failed') {
          finish(new Error(`onboarding failed: ${event.code} — ${event.message}`));
        }
      }
    });
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`onboarding process exited with code ${code} before completion${stderr ? `: ${stderr}` : ''}`));
    });
    child.on('error', (error) => finish(error));
  });
}

async function authorizeDevice(context, userCode) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registration = await context.fetchImpl(`${context.baseUrl}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `onboard-e2e-${suffix}@example.com`, password: 'AgentWiki9Test', name: 'Onboarding E2E' }),
  });
  if (!registration.ok) throw new Error(`E2E registration failed with ${registration.status}`);
  const registered = await registration.json();
  context.auth.token = registered.access_token;
  context.fixture.userId = registered.user?.id ?? null;
  const decision = await context.fetchImpl(`${context.baseUrl}/onboard/device/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${context.auth.token}` },
    body: JSON.stringify({ userCode, decision: 'approve' }),
  });
  if (!decision.ok) throw new Error(`device approval failed with ${decision.status}`);
}

function sendInputReply(child, requestId, values) {
  child.stdin?.write(`${JSON.stringify({ requestId, values })}\n`);
}

function sendConfirmationReply(child, requestId, planHash) {
  child.stdin?.write(`${JSON.stringify({ requestId, confirmed: true, planHash })}\n`);
}

function assertCompletion(result) {
  if (!result.report) throw new Error('no completion report');
  if (!result.report.space?.id) throw new Error('missing space ID in report');
  if (!result.report.agent?.id) throw new Error('missing agent ID in report');
  if (!result.report.revisionId) throw new Error('missing first-sync revision in report');
  if (!result.report.connectionId || !result.report.manifestHash) throw new Error('missing verified gateway evidence in report');
}

if (process.argv[1]?.endsWith('onboarding-e2e.mjs')) {
  let parsed;
  try { parsed = parseArgs(process.argv); } catch (error) { process.stderr.write(`E2E FAILED: ${error.message}\n`); process.exit(1); }
  runOnboardingHarness(parsed)
    .then((result) => process.stdout.write(`${JSON.stringify({ ok: true, sessionId: result.sessionId }, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`E2E FAILED: ${error.message}\n`); process.exitCode = 1; });
}
