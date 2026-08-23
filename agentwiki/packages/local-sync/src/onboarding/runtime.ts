import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createInterface as createPromisesInterface } from 'node:readline/promises';
import { join } from 'node:path';

import type { OnboardCliInput } from '../cli.js';
import { loadConfig, loadCredentials } from '../config.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { AdapterManager } from '../adapter/manager.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { createKnowledgeWorkflowRuntime } from '../gateway/workflow-runtime.js';
import type { KnowledgeWorkflows, RemoteSync } from '../gateway/knowledge-workflows.js';
import { OnboardingClient } from './client.js';
import { OnboardingCoordinator, type BootstrapInstallFn, type KnowledgeWorkflowFn, type PreflightFn } from './coordinator.js';
import { createBootstrapInstaller } from './install.js';
import { preflight } from './preflight.js';
import { ProtocolEncoder, type ProtocolSink, type ProtocolSource } from './protocol.js';
import { createSessionStore } from './session.js';
import { CodeGraphPipeline } from '../codegraph/pipeline.js';
import { createCodeGraphProvider } from '../codegraph/provider.js';

export interface OnboardingRuntimeDeps {
  sessionId(): string;
  sink: ProtocolSink;
  source: ProtocolSource;
  client: OnboardingClient;
  preflight: PreflightFn;
  bootstrapInstall: BootstrapInstallFn;
  knowledge: KnowledgeWorkflowFn;
  sleep(ms: number): Promise<void>;
}

export async function runOnboarding(
  input: OnboardCliInput,
  overrides: Partial<OnboardingRuntimeDeps> = {},
): Promise<{ sessionId: string; report: Record<string, unknown> }> {
  const sessionId = input.sessionId ?? (overrides.sessionId ?? randomUUID)();
  const human = input.protocol === 'human' && !overrides.sink && !overrides.source
    ? humanTransport()
    : undefined;
  const sink = overrides.sink ?? human?.sink ?? { write: (line: string) => { process.stdout.write(line); } };
  const source = overrides.source ?? human?.source ?? stdinSource();
  const store = createSessionStore(sessionId, input.home);
  const knowledge = overrides.knowledge ?? installedKnowledge(input.home);
  const coordinator = new OnboardingCoordinator({
    sessionId,
    client: overrides.client ?? new OnboardingClient(),
    store,
    encoder: new ProtocolEncoder(sessionId, sink),
    source,
    serverBaseUrl: input.serverBaseUrl,
    packageVersion: '0.6.0',
    home: input.home,
    preflight: overrides.preflight ?? preflight,
    bootstrapInstall: overrides.bootstrapInstall ?? createBootstrapInstaller(),
    knowledge,
    sleep: overrides.sleep,
  });
  try {
    return await coordinator.run();
  } finally {
    // NDJSON mode keeps stdin open via a readline interface; close it so the
    // process exits promptly after a terminal event. Human transport closes
    // its own readline in the sink; overrides manage their own lifecycle.
    if ('close' in source && typeof (source as { close?: () => void }).close === 'function') {
      (source as { close: () => void }).close();
    }
  }
}

function stdinSource(): ProtocolSource {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const source: ProtocolSource & { close: () => void } = {
    read: async () => {
      const next = await lines.next();
      return next.done ? null : next.value;
    },
    close: () => rl.close(),
  };
  return source;
}

function installedKnowledge(home: string): KnowledgeWorkflowFn {
  let workflows: KnowledgeWorkflows | undefined;
  const scanSources = new CodeGraphPipeline({ home, provider: createCodeGraphProvider({ home }) });
  const load = async (): Promise<KnowledgeWorkflows> => {
    if (workflows) return workflows;
    const config = await loadConfig(home);
    const connectionId = config.defaultConnectionId;
    if (!connectionId) throw new Error('onboarding gateway connection is missing');
    const connection = config.connections[connectionId];
    if (!connection) throw new Error(`onboarding connection ${connectionId} is missing`);
    const credentials = await loadCredentials(home);
    const apiKey = credentials.credentials[connection.credentialId]?.apiKey;
    if (!apiKey) throw new Error('onboarding gateway credential is missing');
    const client = new AgentWikiClient();
    const engine = (spaceId: string) => new SyncEngine({ connection, apiKey, client, home, spaceId });
    const sync: RemoteSync = {
      pull: async (spaceId) => ({ revisionId: (await engine(spaceId).pull()).revisionId }),
      push: async (spaceId, bundle) => {
        try {
          const result = await engine(spaceId).push(bundle);
          return {
            conflict: false,
            revisionId: result.currentRevision,
            status: result.status,
            submissionId: result.submissionId,
            changeSetId: result.changeSetId,
          };
        } catch (error) {
          if (error instanceof Error && /conflict|stale/i.test(error.message)) {
            return { conflict: true, revisionId: '' };
          }
          throw error;
        }
      },
    };
    workflows = createKnowledgeWorkflowRuntime({
      home,
      adapters: new AdapterManager({ runtimeHome: join(home, '.agentwiki', 'adapters') }),
      sync,
      scanSources,
    });
    return workflows;
  };
  return {
    planLocalScan: async (value) => scanSources.plan(value),
    pull: async (value) => (await load()).pull(value),
    prepare: async (value) => (await load()).prepare({
      ...value,
      sourceType: value.sourceType as 'auto' | 'code' | 'documents' | undefined,
    }),
    confirmAndSync: async (value) => (await load()).confirmAndSync(value),
  };
}

function humanTransport(): { sink: ProtocolSink; source: ProtocolSource } {
  const readline = createPromisesInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let pending: Record<string, unknown> | undefined;
  const sink: ProtocolSink = {
    write(line) {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'input_required' || event.type === 'confirmation_required') pending = event;
      else if (event.type === 'authorization_required') {
        process.stdout.write(`\n请在浏览器授权：${String(event.url)}\n授权码：${String(event.userCode)}\n`);
      } else if (event.type === 'progress') {
        process.stdout.write(`[${String(event.step)}] ${String(event.status)}\n`);
      } else if (event.type === 'preview') {
        process.stdout.write(`\n计划预览：\n${JSON.stringify(event.plan, null, 2)}\n`);
      } else if (event.type === 'completed') {
        process.stdout.write(`\n接入完成：\n${JSON.stringify(event.report, null, 2)}\n`);
        readline.close();
      } else if (event.type === 'failed') {
        process.stderr.write(`接入失败 [${String(event.code)}]：${String(event.message)}\n`);
        readline.close();
      }
    },
  };
  const source: ProtocolSource = {
    async read() {
      const event = pending;
      pending = undefined;
      if (!event) return null;
      const requestId = String(event.requestId);
      if (event.type === 'confirmation_required') {
        const answer = (await readline.question('确认继续？[y/N] ')).trim().toLowerCase();
        return JSON.stringify({ requestId, confirmed: answer === 'y' || answer === 'yes', planHash: event.planHash });
      }
      const values: Record<string, unknown> = {};
      for (const field of (event.fields as Array<Record<string, unknown>>) ?? []) {
        const name = String(field.name);
        const choices = Array.isArray(field.choices) ? ` (${field.choices.join('/')})` : '';
        const fallback = field.defaultValue === undefined ? '' : String(field.defaultValue);
        const answer = (await readline.question(`${String(field.label)}${choices}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
        values[name] = field.type === 'paths' ? answer.split(',').map((part) => part.trim()).filter(Boolean) : answer;
      }
      return JSON.stringify({ requestId, values });
    },
  };
  return { sink, source };
}
