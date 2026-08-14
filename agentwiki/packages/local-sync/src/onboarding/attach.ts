import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createInterface as createPromisesInterface } from 'node:readline/promises';

import { AgentWikiClient, type ExchangeResult } from '../agentwiki-client.js';
import { detectClient, type AgentClient } from '../agent-clients.js';
import { analyzeConfig } from '../installer/client-config.js';
import { GATEWAY_PACKAGE_VERSION } from '../installer/plan.js';
import { installExchangedGateway, type ExchangedGatewayInstallInput } from './install.js';
import { OnboardingError } from './errors.js';
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
  detectClient(requested: AgentClient | 'auto'): AgentClient;
  analyzeConfig(
    client: AgentClient,
    home: string,
    serverBaseUrl: string,
  ): Promise<{ hash: string; oldEntries: string[]; hasConflict: boolean }>;
  confirm(plan: AttachmentPlan): Promise<boolean>;
  exchange(serverBaseUrl: string, code: string): Promise<ExchangeResult>;
  install(input: ExchangedGatewayInstallInput): Promise<AttachmentInstallResult>;
  complete?(report: AttachReport): void;
  close?(): void;
}

export async function runAttachment(
  input: AttachCliInput,
  overrides: Partial<AttachmentDependencies> = {},
): Promise<AttachReport> {
  const deps = { ...productionDependencies(input), ...overrides };
  try {
    const client = deps.detectClient(input.requestedClient);
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
    const connectionId = randomUUID();
    const installed = await deps.install({
      home: input.home,
      client,
      connectionId,
      expectedConfigHash: analysis.hash,
      expectedAgentId: exchange.agentId,
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
  } finally {
    deps.close?.();
  }
}

function productionDependencies(input: AttachCliInput): AttachmentDependencies {
  const agentwiki = new AgentWikiClient();
  const protocol = attachmentProtocol(input);
  return {
    detectClient: (requested) => detectClient(requested, (command, args, options) => (
      spawnSync(command, args, { stdio: 'pipe', ...options })
    )),
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
    close: protocol.close,
  };
}

function attachmentProtocol(input: AttachCliInput): {
  confirm(plan: AttachmentPlan): Promise<boolean>;
  complete(report: AttachReport): void;
  close(): void;
} {
  if (input.protocol === 'human') {
    const terminal = createPromisesInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return {
      async confirm(plan) {
        process.stdout.write(`\n统一 AgentWiki gateway 安装计划：\n${JSON.stringify(plan, null, 2)}\n`);
        const answer = (await terminal.question('确认继续？[y/N] ')).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
      },
      complete(report) {
        process.stdout.write(`\n接入完成：\n${JSON.stringify(report, null, 2)}\n`);
      },
      close: () => terminal.close(),
    };
  }

  const sessionId = randomUUID();
  const encoder = new ProtocolEncoder(sessionId, {
    write: (line) => { process.stdout.write(line); },
  });
  const reader = createInterface({ input: process.stdin, terminal: false });
  const lines = reader[Symbol.asyncIterator]();
  return {
    async confirm(plan) {
      const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
      const requestId = randomUUID();
      const payload = plan as unknown as Record<string, unknown>;
      encoder.emit({ type: 'preview', plan: payload });
      encoder.emit({ type: 'confirmation_required', requestId, planHash, summary: payload });
      const line = await lines.next();
      if (line.done) return false;
      const reply = parseReply(line.value);
      return isConfirmationReply(reply)
        && reply.requestId === requestId
        && reply.planHash === planHash
        && reply.confirmed;
    },
    complete(report) {
      encoder.emit({ type: 'completed', report: report as unknown as Record<string, unknown> });
    },
    close: () => reader.close(),
  };
}
