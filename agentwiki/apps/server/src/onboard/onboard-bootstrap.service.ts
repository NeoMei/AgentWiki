import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { LocalSyncInstallationService } from '../core/agent/local-sync-installation.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import type { OnboardingPrincipal } from './onboarding-token.guard';
import {
  hashServerPlan,
  normalizeServerPlan,
  type NormalizedServerPlan,
  type ServerPlan,
} from './onboard.types';

const REPLAY_TTL_SECONDS = 600;
const CLAIM_STALE_MS = 30_000;
const CLAIM_WAIT_ATTEMPTS = 100;
const CLAIM_WAIT_MS = 20;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const REQUIRED_CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
  'bootstrap:grant',
  'bootstrap:installation',
].sort();

type ResourceIds = {
  spaceId: string;
  agentId: string;
  grantId: string;
  pendingInstallationId?: string;
};

type BootstrapResources = {
  ids: ResourceIds;
  space: { id: string; name: string };
  agent: { id: string; name: string };
  grant: { id: string; role: 'editor'; scopes: string[] };
};

export type OnboardBootstrapResponse = {
  space: { id: string; name: string };
  agent: { id: string; name: string };
  grant: { role: 'editor'; scopes: string[] };
  installation: { code: string; installationId: string; expiresAt: string };
};

type BootstrapRecord = {
  id: string;
  deviceSessionId: string;
  idempotencyKeyHash: string;
  serverPlanHash: string;
  status: string;
  resourceIds: unknown;
  resultHash: string | null;
  updatedAt: Date;
};

@Injectable()
export class OnboardBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly installations: LocalSyncInstallationService,
    private readonly config: ConfigService,
  ) {}

  async bootstrap(
    context: OnboardingPrincipal,
    idempotencyKey: unknown,
    plan: ServerPlan,
    suppliedPlanHash: string,
  ): Promise<OnboardBootstrapResponse> {
    const key = this.validateIdempotencyKey(idempotencyKey);
    const normalized = normalizeServerPlan(plan);
    const canonicalPlanHash = hashServerPlan(normalized);
    this.assertAuthorizedPlan(context, normalized, suppliedPlanHash, canonicalPlanHash);
    const keyHash = this.hash(key);

    const claim = await this.claim(context.sessionId, keyHash, canonicalPlanHash);
    if (!this.sameRequest(claim.record, context.sessionId, keyHash, canonicalPlanHash)) {
      throw new BusinessException('ONBOARDING_REPLAY_MISMATCH');
    }

    const savedReplay = await this.readReplay(claim.record);
    if (savedReplay) {
      await this.finalizeSavedReplay(claim.record, savedReplay, context.sessionId);
      return savedReplay;
    }

    if (!claim.owned) {
      const completed = await this.waitForWinner(
        claim.record,
        context.sessionId,
        keyHash,
        canonicalPlanHash,
      );
      if (completed) return completed;
      throw new BusinessException(
        'RESOURCE_CONFLICT',
        'Onboarding bootstrap is still running; retry the same request',
      );
    }

    let resources: BootstrapResources | null = null;
    let issuedInstallationId: string | null = null;
    let replaySaved = false;
    try {
      resources = claim.record.resourceIds
        ? await this.loadResources(this.resourceIds(claim.record.resourceIds))
        : await this.createResources(claim.record.id, context.userId, context.sessionId, normalized);

      if (resources.ids.pendingInstallationId) {
        await this.revokePendingInstallation(context.userId, resources.ids);
        resources.ids = {
          spaceId: resources.ids.spaceId,
          agentId: resources.ids.agentId,
          grantId: resources.ids.grantId,
        };
        await this.persistResourceIds(claim.record.id, resources.ids);
      }

      const installation = await this.installations.issueForBootstrap({
        ownerId: context.userId,
        agentId: resources.agent.id,
        scopes: normalized.scopes,
        pluginVersion: normalized.packageVersion,
        serverUrl: this.publicApiUrl(),
      });
      issuedInstallationId = installation.installationId;
      resources.ids = {
        ...resources.ids,
        pendingInstallationId: installation.installationId,
      };
      await this.persistResourceIds(claim.record.id, resources.ids);

      const response: OnboardBootstrapResponse = {
        space: resources.space,
        agent: resources.agent,
        grant: { role: 'editor', scopes: [...normalized.scopes] },
        installation: {
          code: installation.code,
          installationId: installation.installationId,
          expiresAt: installation.expiresAt,
        },
      };
      await this.redis.setStrict(
        this.replayKey(claim.record.id),
        JSON.stringify(response),
        REPLAY_TTL_SECONDS,
      );
      replaySaved = true;
      await this.prisma.onboardingBootstrap.update({
        where: { id: claim.record.id },
        data: {
          status: 'completed',
          resultHash: this.hash(JSON.stringify(response)),
        },
      });
      await this.consumeToken(context.sessionId);
      return {
        space: { id: response.space.id, name: response.space.name },
        agent: { id: response.agent.id, name: response.agent.name },
        grant: { role: 'editor', scopes: [...response.grant.scopes] },
        installation: {
          code: response.installation.code,
          installationId: response.installation.installationId,
          expiresAt: response.installation.expiresAt,
        },
      };
    } catch (error) {
      if (!replaySaved && issuedInstallationId && resources) {
        try {
          await this.installations.revoke(
            context.userId,
            resources.agent.id,
            issuedInstallationId,
          );
          const cleanIds: ResourceIds = {
            spaceId: resources.ids.spaceId,
            agentId: resources.ids.agentId,
            grantId: resources.ids.grantId,
          };
          await this.persistResourceIds(claim.record.id, cleanIds);
        } catch {
          // Keep pendingInstallationId so an exact retry can revoke before reissuing.
        }
      }
      if (!replaySaved) await this.markFailed(claim.record.id);
      throw error;
    }
  }

  private async claim(
    deviceSessionId: string,
    idempotencyKeyHash: string,
    serverPlanHash: string,
  ): Promise<{ record: BootstrapRecord; owned: boolean }> {
    try {
      const record = await this.prisma.onboardingBootstrap.create({
        data: { deviceSessionId, idempotencyKeyHash, serverPlanHash, status: 'running' },
      });
      return { record: record as BootstrapRecord, owned: true };
    } catch (error) {
      if (!this.isUniqueConstraint(error)) throw error;
    }

    const existing = await this.prisma.onboardingBootstrap.findUnique({
      where: { deviceSessionId },
    }) as BootstrapRecord | null;
    if (!existing) {
      throw new BusinessException('RESOURCE_CONFLICT', 'Onboarding bootstrap claim disappeared; retry');
    }
    if (!this.sameRequest(existing, deviceSessionId, idempotencyKeyHash, serverPlanHash)) {
      return { record: existing, owned: false };
    }
    if (existing.status === 'failed') {
      const resumed = await this.prisma.onboardingBootstrap.updateMany({
        where: { id: existing.id, status: 'failed', updatedAt: existing.updatedAt },
        data: { status: 'running' },
      });
      if (resumed.count === 1) {
        return { record: { ...existing, status: 'running' }, owned: true };
      }
    }
    if (
      existing.status === 'running'
      && existing.updatedAt.getTime() <= Date.now() - CLAIM_STALE_MS
    ) {
      const resumed = await this.prisma.onboardingBootstrap.updateMany({
        where: { id: existing.id, status: 'running', updatedAt: existing.updatedAt },
        data: { status: 'running' },
      });
      if (resumed.count === 1) return { record: existing, owned: true };
    }
    return { record: existing, owned: false };
  }

  private async waitForWinner(
    initial: BootstrapRecord,
    deviceSessionId: string,
    idempotencyKeyHash: string,
    serverPlanHash: string,
  ): Promise<OnboardBootstrapResponse | null> {
    let record = initial;
    for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt += 1) {
      const replay = await this.readReplay(record);
      if (replay) {
        await this.finalizeSavedReplay(record, replay, deviceSessionId);
        return replay;
      }
      await this.pause(CLAIM_WAIT_MS);
      const latest = await this.prisma.onboardingBootstrap.findUnique({
        where: { deviceSessionId },
      }) as BootstrapRecord | null;
      if (!latest || !this.sameRequest(latest, deviceSessionId, idempotencyKeyHash, serverPlanHash)) {
        throw new BusinessException('ONBOARDING_REPLAY_MISMATCH');
      }
      record = latest;
      if (record.status === 'failed') return null;
    }
    return null;
  }

  private async createResources(
    bootstrapId: string,
    userId: string,
    deviceSessionId: string,
    plan: NormalizedServerPlan,
  ): Promise<BootstrapResources> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const space = plan.space.mode === 'create'
          ? await tx.space.create({
            data: {
              name: plan.space.name,
              slug: `${this.slugify(plan.space.name)}-${deviceSessionId.slice(-8)}`,
              visibility: 'private',
              approvalPolicy: plan.approvalMode,
              members: { create: { userId, role: 'owner' } },
            },
          })
          : await tx.space.findFirst({
            where: {
              id: plan.space.id,
              deletedAt: null,
              members: { some: { userId, role: { in: ['owner', 'admin'] } } },
            },
          });
        if (!space) throw new BusinessException('SPACE_ACCESS_DENIED');
        if (
          plan.space.mode === 'existing'
          && plan.approvalMode === 'scoped-auto-publish'
          && space.approvalPolicy !== 'scoped-auto-publish'
        ) {
          throw new BusinessException(
            'RESOURCE_CONFLICT',
            'Existing Space policy does not allow scoped auto-publish',
          );
        }

        const existingAgent = await tx.agent.findFirst({
          where: {
            ownerId: userId,
            revokedAt: null,
            status: 'active',
            name: plan.agentName,
            approvalMode: plan.approvalMode,
          },
        });
        const agent = existingAgent || await tx.agent.create({
          data: {
            ownerId: userId,
            name: plan.agentName,
            approvalMode: plan.approvalMode,
          },
        });
        const grant = await tx.agentGrant.upsert({
          where: { agentId_spaceId: { agentId: agent.id, spaceId: space.id } },
          create: {
            agentId: agent.id,
            spaceId: space.id,
            role: 'editor',
            scopes: [...plan.scopes],
          },
          update: { role: 'editor', scopes: [...plan.scopes] },
        });
        const ids: ResourceIds = {
          spaceId: space.id,
          agentId: agent.id,
          grantId: grant.id,
        };
        await tx.onboardingBootstrap.update({
          where: { id: bootstrapId },
          data: { resourceIds: ids as Prisma.InputJsonValue },
        });
        return {
          ids,
          space: { id: space.id, name: space.name },
          agent: { id: agent.id, name: agent.name },
          grant: { id: grant.id, role: 'editor' as const, scopes: [...plan.scopes] },
        };
      });
    } catch (error) {
      await this.markFailed(bootstrapId);
      throw error;
    }
  }

  private async loadResources(ids: ResourceIds): Promise<BootstrapResources> {
    const [space, agent, grant] = await Promise.all([
      this.prisma.space.findUnique({ where: { id: ids.spaceId } }),
      this.prisma.agent.findUnique({ where: { id: ids.agentId } }),
      this.prisma.agentGrant.findUnique({ where: { id: ids.grantId } }),
    ]);
    if (
      !space || space.deletedAt
      || !agent || agent.revokedAt || agent.status !== 'active'
      || !grant || grant.agentId !== ids.agentId || grant.spaceId !== ids.spaceId
    ) {
      throw new BusinessException('RESOURCE_CONFLICT', 'Onboarding bootstrap resources are unavailable');
    }
    return {
      ids,
      space: { id: space.id, name: space.name },
      agent: { id: agent.id, name: agent.name },
      grant: { id: grant.id, role: 'editor', scopes: [...grant.scopes] },
    };
  }

  private async persistResourceIds(bootstrapId: string, ids: ResourceIds): Promise<void> {
    await this.prisma.onboardingBootstrap.update({
      where: { id: bootstrapId },
      data: { resourceIds: ids as Prisma.InputJsonValue },
    });
  }

  private async readReplay(record: BootstrapRecord): Promise<OnboardBootstrapResponse | null> {
    const serialized = await this.redis.getStrict(this.replayKey(record.id));
    if (!serialized) return null;
    const response = this.parseReplay(serialized);
    const resultHash = this.hash(JSON.stringify(response));
    if (record.resultHash && record.resultHash !== resultHash) {
      throw new BusinessException('ONBOARDING_REPLAY_MISMATCH', 'Saved onboarding result is inconsistent');
    }
    return response;
  }

  private async finalizeSavedReplay(
    record: BootstrapRecord,
    response: OnboardBootstrapResponse,
    sessionId: string,
  ): Promise<void> {
    if (record.status !== 'completed' || !record.resultHash) {
      await this.prisma.onboardingBootstrap.update({
        where: { id: record.id },
        data: { status: 'completed', resultHash: this.hash(JSON.stringify(response)) },
      });
    }
    await this.consumeToken(sessionId);
  }

  private parseReplay(serialized: string): OnboardBootstrapResponse {
    try {
      const response = JSON.parse(serialized) as OnboardBootstrapResponse;
      if (
        typeof response?.space?.id !== 'string'
        || typeof response.space.name !== 'string'
        || typeof response?.agent?.id !== 'string'
        || typeof response.agent.name !== 'string'
        || response?.grant?.role !== 'editor'
        || !Array.isArray(response.grant.scopes)
        || response.grant.scopes.some((scope) => typeof scope !== 'string')
        || typeof response?.installation?.code !== 'string'
        || typeof response.installation.installationId !== 'string'
        || typeof response.installation.expiresAt !== 'string'
        || Object.prototype.hasOwnProperty.call(response, 'apiKey')
      ) throw new Error('Invalid replay');
      return {
        space: { id: response.space.id, name: response.space.name },
        agent: { id: response.agent.id, name: response.agent.name },
        grant: { role: 'editor', scopes: [...response.grant.scopes] },
        installation: {
          code: response.installation.code,
          installationId: response.installation.installationId,
          expiresAt: response.installation.expiresAt,
        },
      };
    } catch {
      throw new BusinessException('RESOURCE_CONFLICT', 'Saved onboarding result is unavailable');
    }
  }

  private resourceIds(value: unknown): ResourceIds {
    const ids = value as Partial<ResourceIds> | null;
    if (
      !ids
      || typeof ids.spaceId !== 'string'
      || typeof ids.agentId !== 'string'
      || typeof ids.grantId !== 'string'
      || (ids.pendingInstallationId !== undefined && typeof ids.pendingInstallationId !== 'string')
    ) {
      throw new BusinessException('RESOURCE_CONFLICT', 'Onboarding resource recovery state is invalid');
    }
    return ids as ResourceIds;
  }

  private async revokePendingInstallation(ownerId: string, ids: ResourceIds): Promise<void> {
    try {
      await this.installations.revoke(ownerId, ids.agentId, ids.pendingInstallationId!);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
  }

  private async consumeToken(sessionId: string): Promise<void> {
    await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: sessionId, tokenConsumedAt: null },
      data: { tokenConsumedAt: new Date() },
    });
  }

  private async markFailed(bootstrapId: string): Promise<void> {
    try {
      await this.prisma.onboardingBootstrap.update({
        where: { id: bootstrapId },
        data: { status: 'failed' },
      });
    } catch {
      // Preserve the original failure; a stale running claim remains recoverable.
    }
  }

  private assertAuthorizedPlan(
    context: OnboardingPrincipal,
    plan: NormalizedServerPlan,
    suppliedPlanHash: string,
    canonicalPlanHash: string,
  ): void {
    const capabilities = [...context.requestedCapabilities].sort();
    if (
      suppliedPlanHash !== canonicalPlanHash
      || plan.packageVersion !== context.packageVersion
      || context.packageVersion !== '0.3.0'
      || context.purpose !== 'full-onboarding'
      || capabilities.length !== REQUIRED_CAPABILITIES.length
      || capabilities.some((capability, index) => capability !== REQUIRED_CAPABILITIES[index])
    ) {
      throw new BusinessException('ONBOARDING_PLAN_HASH_MISMATCH');
    }
  }

  private sameRequest(
    record: BootstrapRecord,
    sessionId: string,
    idempotencyKeyHash: string,
    serverPlanHash: string,
  ): boolean {
    return record.deviceSessionId === sessionId
      && record.idempotencyKeyHash === idempotencyKeyHash
      && record.serverPlanHash === serverPlanHash;
  }

  private validateIdempotencyKey(value: unknown): string {
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
      throw new BusinessException('ONBOARDING_IDEMPOTENCY_KEY_INVALID');
    }
    return value;
  }

  private publicApiUrl(): string {
    const configured = this.config.get<string>('PUBLIC_API_URL');
    if (configured) return configured.replace(/\/+$/, '');
    if (this.config.get<string>('NODE_ENV') === 'development') return 'http://localhost:3000/api';
    throw new InternalServerErrorException('PUBLIC_API_URL is required outside development');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private replayKey(bootstrapId: string): string {
    return `onboarding:bootstrap-result:${bootstrapId}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private isUniqueConstraint(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === 'P2002';
  }

  private pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
