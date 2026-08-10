#!/usr/bin/env node
/**
 * Onboarding E2E harness.
 *
 * Drives the pinned 0.3.0 onboard command via NDJSON stdin/stdout. The
 * harness is destructive only for an explicit loopback target unless
 * production opt-in and cleanup credentials are supplied.
 *
 * Usage:
 *   AGENTWIKI_E2E=1 node scripts/onboarding-e2e.mjs --target http://localhost:3000/api
 */
import { spawn } from 'node:child_process';
import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

const DISPOSABLE_PREFIX = `aw-e2e-${Date.now()}`;
const HARNESS_DEADLINE_MS = 5 * 60 * 1_000; // 5 minutes total

function parseArgs(argv) {
  const args = argv.slice(2);
  const target = args[args.indexOf('--target') + 1];
  if (!target) throw new Error('--target <url> is required');
  return { target };
}

/**
 * Drive the onboard CLI via NDJSON. Returns the final event or throws.
 *
 * @param {object} opts
 * @param {string} opts.target - Server base URL.
 * @param {object} [opts.env] - Environment override for tests.
 * @param {function} [opts.spawnImpl] - Spawn override for tests.
 */
export async function runOnboardingHarness(opts) {
  if (!opts.target) throw new Error('--target <url> is required');
  const baseUrl = assertE2ETarget(opts.target, opts.env ?? process.env, 'AGENTWIKI_E2E');
  const startTime = Date.now();

  const fixture = { spaceId: null, agentId: null, userId: null };
  let child;

  try {
    child = (opts.spawnImpl ?? defaultSpawn)(baseUrl);

    const result = await driveProtocol(child, startTime);

    // Extract resource IDs from the completed report.
    if (result.report?.space?.id) fixture.spaceId = result.report.space.id;
    if (result.report?.agent?.id) fixture.agentId = result.report.agent.id;

    // Verify completion criteria.
    assertCompletion(result);

    return { sessionId: result.sessionId, report: result.report, fixture };
  } finally {
    if (child?.kill) child.kill('SIGKILL');
    // Best-effort cleanup in production E2E; loopback tests clean up manually.
    if (fixture.spaceId || fixture.agentId) {
      try {
        await cleanupFixture(fixture, async () => {});
      } catch {
        // non-fatal in harness
      }
    }
  }
}

function defaultSpawn(baseUrl) {
  return spawn('npx', [
    '--yes', '@neomei/agentwiki-local-sync@0.3.0', 'onboard',
    '--server', baseUrl,
    '--protocol', 'ndjson',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
}

async function driveProtocol(child, startTime) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let sessionId = null;
    let report = null;
    const timer = setTimeout(() => {
      reject(new Error(`onboarding harness timed out after ${HARNESS_DEADLINE_MS}ms`));
    }, HARNESS_DEADLINE_MS);

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
          // Respond with disposable fixture values.
          sendReply(child, event.requestId, {
            spaceMode: 'create',
            spaceName: `${DISPOSABLE_PREFIX}-space`,
            agentName: `${DISPOSABLE_PREFIX}-agent`,
            permissionPreset: 'editor',
            approvalMode: 'always-review',
            clientType: 'codex',
            sourcePaths: ['.'],
          });
        } else if (event.type === 'confirmation_required') {
          sendReply(child, event.requestId, { confirmed: true, planHash: event.planHash });
        } else if (event.type === 'completed') {
          report = event.report;
          clearTimeout(timer);
          resolve({ sessionId, report });
        } else if (event.type === 'failed') {
          clearTimeout(timer);
          reject(new Error(`onboarding failed: ${event.code} — ${event.message}`));
        }
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (report === null && code !== 0) {
        reject(new Error(`onboarding process exited with code ${code} before completion`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendReply(child, requestId, values) {
  const reply = JSON.stringify({ requestId, values });
  child.stdin?.write(reply + '\n');
}

function assertCompletion(result) {
  if (!result.report) throw new Error('no completion report');
  if (!result.report.space?.id) throw new Error('missing space ID in report');
  if (!result.report.agent?.id) throw new Error('missing agent ID in report');
}

// CLI entry point
if (process.argv[1]?.endsWith('onboarding-e2e.mjs')) {
  const { target } = parseArgs(process.argv);
  runOnboardingHarness({ target })
    .then((result) => {
      process.stdout.write(JSON.stringify({ ok: true, sessionId: result.sessionId }, null, 2) + '\n');
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`E2E FAILED: ${err.message}\n`);
      process.exit(1);
    });
}
