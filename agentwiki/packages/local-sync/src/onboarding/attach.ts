import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createInterface as createPromisesInterface } from 'node:readline/promises';

import { AgentWikiClient, redactSecrets, type ExchangeResult } from '../agentwiki-client.js';
import { detectInstalledClients, type AgentClient } from '../agent-clients.js';
import { analyzeConfig } from '../installer/client-config.js';
import { GATEWAY_PACKAGE_VERSION } from '../installer/plan.js';
import { installExchangedGateway, type ExchangedGatewayInstallInput } from './install.js';
import { OnboardingError, type OnboardingFailure } from './errors.js';
import { ProtocolEncoder, isConfirmationReply, parseReply } from './protocol.js';

export interface AttachCliInput {
  home: string;
  protocol: 'ndjson' | 'human';
  serverBaseUrl: string;
  code: string;
  requestedClient: AgentClient | 'auto';
}

export interface AttachmentPlan {
  client: AgentClient;
  serverUrl: string;
  mcpName: 'agentwiki';
  oldEntries: string[];
  reloadRequired: boolean;
}

export interface AttachmentInstallResult {
  connectionId: string;
  configBackupPath: string;
  manifestHash: string;
}

export interface AttachReport extends AttachmentInstallResult {
  agentId: string;
  client: AgentClient;
  mcpName: 'agentwiki';
  migratedEntries: string[];
  reloadRequired: boolean;
}

export interface AttachmentDependencies {
  detectClients(requested: AgentClient | 'auto'): AgentClient[];
  selectClient(candidates: AgentClient[]): Promise<AgentClient>;
  analyzeConfig(
    client: AgentClient,
    home: string,
    serverBaseUrl: string,
  ): Promise<{ hash: string; oldEntries: string[]; hasConflict: boolean }>;
  confirm(plan: AttachmentPlan): Promise<boolean>;
  exchange(serverBaseUrl: string, code: string): Promise<ExchangeResult>;
  install(input: ExchangedGatewayInstallInput): Promise<AttachmentInstallResult>;
  complete?(report: AttachReport): void;
  fail?(failure: OnboardingFailure): void;
  close?(): void;
}

export async function runAttachment(
  input: AttachCliInput,
  overrides: Partial<AttachmentDependencies> = {},
): Promise<AttachReport> {
  const deps = { ...productionDependencies(input), ...overrides };
  try {
    const candidates = deps.detectClients(input.requestedClient);
    if (candidates.length === 0) {
      throw new OnboardingError({
        code: 'CLIENT_UNSUPPORTED',
        message: 'no supported Agent client is installed',
        retryable: false,
      });
    }
    const client = candidates.length === 1 ? candidates[0] : await deps.selectClient(candidates);
    const analysis = await deps.analyzeConfig(client, input.home, input.serverBaseUrl);
    if (analysis.hasConflict) {
      throw new OnboardingError({
        code: 'CONFIG_CONFLICT',
        message: 'an unknown entry already occupies the agentwiki MCP name',
        retryable: false,
      });
    }
    const plan: AttachmentPlan = {
      client,
      serverUrl: input.serverBaseUrl.replace(/\/+$/, ''),
      mcpName: 'agentwiki',
      oldEntries: analysis.oldEntries,
      reloadRequired: client === 'opencode',
    };
    if (!await deps.confirm(plan)) {
      throw new OnboardingError({
        code: 'AUTH_DENIED',
        message: 'user cancelled the unified gateway installation',
        retryable: false,
      });
    }

    const exchange = await deps.exchange(input.serverBaseUrl, input.code);
    const connectionId = connectionIdForCode(input.code);
    const installed = await deps.install({
      home: input.home,
      client,
      connectionId,
      expectedConfigHash: analysis.hash,
      expectedAgentId: exchange.agentId,
      expectedSpaceId: exchange.spaceId,
      expectedRole: exchange.role,
      expectedScopes: exchange.scopes,
      expectedPluginVersion: GATEWAY_PACKAGE_VERSION,
      exchange,
    });
    const report: AttachReport = {
      ...installed,
      agentId: exchange.agentId,
      client,
      mcpName: 'agentwiki',
      migratedEntries: analysis.oldEntries,
      reloadRequired: client === 'opencode',
    };
    deps.complete?.(report);
    return report;
  } catch (error) {
    deps.fail?.(attachmentFailure(error));
    throw error;
  } finally {
    deps.close?.();
  }
}

function productionDependencies(input: AttachCliInput): AttachmentDependencies {
  const agentwiki = new AgentWikiClient();
  const protocol = attachmentProtocol(input);
  return {
    detectClients: (requested) => requested === 'auto'
      ? detectInstalledClients((command, args, options) => (
        spawnSync(command, args, { stdio: 'pipe', ...options })
      ))
      : [requested],
    selectClient: protocol.selectClient,
    analyzeConfig: (client, home, serverBaseUrl) => analyzeConfig(client, home, serverBaseUrl),
    confirm: protocol.confirm,
    exchange: (serverBaseUrl, code) => agentwiki.exchange(serverBaseUrl, code),
    install: async (installInput) => {
      const result = await installExchangedGateway(installInput);
      return {
        connectionId: result.connection.id,
        configBackupPath: result.configBackupPath,
        manifestHash: result.manifestHash,
      };
    },
    complete: protocol.complete,
    fail: protocol.fail,
    close: protocol.close,
  };
}

function attachmentProtocol(input: AttachCliInput): {
  selectClient(candidates: AgentClient[]): Promise<AgentClient>;
  confirm(plan: AttachmentPlan): Promise<boolean>;
  complete(report: AttachReport): void;
  fail(failure: OnboardingFailure): void;
  close(): void;
} {
  if (input.protocol === 'human') {
    const terminal = createPromisesInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return {
      async selectClient(candidates) {
        const answer = (await terminal.question(`选择当前 Agent (${candidates.join('/')}): `)).trim().toLowerCase();
        if (candidates.includes(answer as AgentClient)) return answer as AgentClient;
        throw protocolFailure('invalid Agent client selection');
      },
      async confirm(plan) {
        process.stdout.write(`\n统一 AgentWiki gateway 安装计划：\n${JSON.stringify(plan, null, 2)}\n`);
        const answer = (await terminal.question('确认继续？[y/N] ')).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
      },
      complete(report) {
        process.stdout.write(`\n接入完成：\n${JSON.stringify(report, null, 2)}\n`);
      },
      fail: () => undefined,
      close: () => terminal.close(),
    };
  }

  const sessionId = randomUUID();
  const encoder = new ProtocolEncoder(sessionId, {
    write: (line) => { process.stdout.write(line); },
  });
  const reader = createInterface({ input: process.stdin, terminal: false });
  const lines = reader[Symbol.asyncIterator]();
  const readReply = async () => {
    const line = await lines.next();
    if (line.done) throw protocolFailure('protocol input ended before a reply');
    return parseReply(line.value);
  };
  return {
    async selectClient(candidates) {
      const requestId = randomUUID();
      encoder.emit({
        type: 'input_required',
        requestId,
        fields: [{
          name: 'client',
          label: 'Agent client',
          type: 'choice',
          choices: candidates,
          required: true,
        }],
      });
      const reply = await readReply();
      if (!('values' in reply) || reply.requestId !== requestId) {
        throw protocolFailure('Agent client reply does not match the request');
      }
      const selected = reply.values.client;
      if (typeof selected !== 'string' || !candidates.includes(selected as AgentClient)) {
        throw protocolFailure('Agent client reply is not one of the available clients');
      }
      return selected as AgentClient;
    },
    async confirm(plan) {
      const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
      const requestId = randomUUID();
      const payload = plan as unknown as Record<string, unknown>;
      encoder.emit({ type: 'preview', plan: payload });
      encoder.emit({ type: 'confirmation_required', requestId, planHash, summary: payload });
      const reply = await readReply();
      if (!isConfirmationReply(reply) || reply.requestId !== requestId || reply.planHash !== planHash) {
        throw protocolFailure('confirmation reply does not match the request');
      }
      return reply.confirmed;
    },
    complete(report) {
      encoder.emit({ type: 'completed', report: report as unknown as Record<string, unknown> });
    },
    fail: (failure) => { encoder.emitFailure(failure); },
    close: () => reader.close(),
  };
}

function protocolFailure(message: string): OnboardingError {
  return new OnboardingError({
    code: 'PROTOCOL_UNSUPPORTED',
    message,
    retryable: false,
  });
}

function connectionIdForCode(code: string): string {
  const value = createHash('sha256').update(code).digest('hex');
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    `5${value.slice(13, 16)}`,
    `a${value.slice(17, 20)}`,
    value.slice(20, 32),
  ].join('-');
}

function attachmentFailure(error: unknown): OnboardingFailure {
  if (error instanceof OnboardingError) {
    return { ...error.toFailure(), message: redactSecrets(error.message) };
  }
  return {
    code: 'SYNC_FAILED',
    message: redactSecrets(error instanceof Error ? error.message : String(error)),
    retryable: false,
  };
}
