import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
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
const EXECUTION_LEASE_MS = 30_000;
const LOSER_WAIT_MS = 2_000;
const INITIAL_BACKOFF_MS = 20;
const MAX_BACKOFF_MS = 200;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const REQUIRED_CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
  'bootstrap:grant',
  'bootstrap:installation',
].sort();

type ExecutionFence = {
  executionId: string;
  generation: number;
};

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
  executionId: string | null;
  generation: number;
  leaseExpiresAt: Date | null;
  resourceIds: unknown;
  resultHash: string | null;
  updatedAt: Date;
};

type Claim = {
  record: BootstrapRecord;
  fence: ExecutionFence | null;
  previous: BootstrapRecord | null;
};

class LostBootstrapOwnershipError extends Error {}
class AmbiguousReplayStateError extends Error {}
class ReplayNotSavedError extends Error {}

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
    if (!claim.fence) {
      if (claim.record.status === 'completed') {
        return this.readCompletedReplay(claim.record, context.sessionId);
      }
      const replay = await this.waitForWinner(
        context.sessionId,
        keyHash,
        canonicalPlanHash,
      );
      if (replay) return replay;
      throw this.retryable('Onboarding bootstrap is still running; retry the same request');
    }

    return this.executeClaim(context, normalized, { ...claim, fence: claim.fence });
  }

  private async executeClaim(
    context: OnboardingPrincipal,
    plan: NormalizedServerPlan,
    claim: Claim & { fence: ExecutionFence },
  ): Promise<OnboardBootstrapResponse> {
    const { fence } = claim;
    let resources: BootstrapResources | null = null;
    let issuedInstallationId: string | null = null;
    let issuedInstallationPersisted = false;
    let replayKnownSaved = false;
    let completed = false;
    try {
      await this.renew(claim.record.id, fence);
      resources = claim.record.resourceIds
        ? await this.loadResources(
          this.resourceIds(claim.record.resourceIds),
          context.userId,
          plan,
        )
        : await this.createResources(
          claim.record.id,
          fence,
          context.userId,
          context.sessionId,
          plan,
        );

      const recovered = await this.recoverPreviousExecution(
        context,
        plan,
        claim,
        resources,
      );
      if (recovered) return recovered;

      await this.renew(claim.record.id, fence);
      const installation = await this.installations.issueForBootstrap({
        ownerId: context.userId,
        agentId: resources.agent.id,
        scopes: plan.scopes,
        pluginVersion: plan.packageVersion,
        serverUrl: this.publicApiUrl(),
      });
      issuedInstallationId = installation.installationId;
      await this.renew(claim.record.id, fence);

      resources.ids = { ...resources.ids, pendingInstallationId: installation.installationId };
      await this.persistResourceIds(claim.record.id, fence, resources.ids);
      issuedInstallationPersisted = true;
      const response = this.response(resources, plan.scopes, installation);
      const serialized = JSON.stringify(response);
      const resultHash = this.hash(serialized);

      await this.renew(claim.record.id, fence);
      replayKnownSaved = await this.storeReplayWithReadback(
        claim.record.id,
        fence,
        serialized,
        resultHash,
      );
      if (!replayKnownSaved) throw new ReplayNotSavedError('Replay response was not saved');
      await this.renew(claim.record.id, fence);

      const completion = await this.prisma.onboardingBootstrap.updateMany({
        where: this.runningFenceWhere(claim.record.id, fence),
        data: { status: 'completed', resultHash, leaseExpiresAt: null },
      });
      if (completion.count !== 1) throw new LostBootstrapOwnershipError();
      completed = true;
      await this.consumeToken(context.sessionId, fence);
      return response;
    } catch (error) {
      if (error instanceof AmbiguousReplayStateError) {
        throw this.retryable('Onboarding replay persistence is uncertain; retry the same request');
      }
      if (error instanceof LostBootstrapOwnershipError) {
        if (issuedInstallationId && resources && !issuedInstallationPersisted) {
          await this.revokeBestEffort(context.userId, resources.agent.id, issuedInstallationId);
        }
        throw this.retryable('Onboarding execution ownership changed; retry the same request');
      }
      if (completed || replayKnownSaved) throw error;

      if (issuedInstallationId && resources) {
        const revoked = await this.revokeBestEffort(
          context.userId,
          resources.agent.id,
          issuedInstallationId,
        );
        if (revoked) {
          resources.ids = this.withoutPendingInstallation(resources.ids);
          await this.persistResourceIdsBestEffort(claim.record.id, fence, resources.ids);
        }
      }
      await this.deleteOwnedReplayBestEffort(claim.record.id, fence);
      await this.markFailed(claim.record.id, fence);
      throw error;
    }
  }

  private async claim(
    deviceSessionId: string,
    idempotencyKeyHash: string,
    serverPlanHash: string,
  ): Promise<Claim> {
    const fence = { executionId: randomUUID(), generation: 1 };
    const leaseExpiresAt = this.newLease();
    try {
      const record = await this.prisma.onboardingBootstrap.create({
        data: {
          deviceSessionId,
          idempotencyKeyHash,
          serverPlanHash,
          status: 'running',
          executionId: fence.executionId,
          generation: fence.generation,
          leaseExpiresAt,
        },
      });
      return { record: record as BootstrapRecord, fence, previous: null };
    } catch (error) {
      if (!this.isUniqueConstraint(error)) throw error;
    }

    const existing = await this.findBootstrap(deviceSessionId);
    if (!existing) throw this.retryable('Onboarding bootstrap claim disappeared; retry');
    if (!this.sameRequest(existing, deviceSessionId, idempotencyKeyHash, serverPlanHash)) {
      return { record: existing, fence: null, previous: null };
    }
    if (existing.status === 'completed') {
      return { record: existing, fence: null, previous: null };
    }
    if (!this.canTakeOver(existing)) {
      return { record: existing, fence: null, previous: null };
    }

    const nextFence = { executionId: randomUUID(), generation: existing.generation + 1 };
    const takeover = await this.prisma.onboardingBootstrap.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        executionId: existing.executionId,
        generation: existing.generation,
        leaseExpiresAt: existing.leaseExpiresAt,
      },
      data: {
        status: 'running',
        executionId: nextFence.executionId,
        generation: { increment: 1 },
        leaseExpiresAt: this.newLease(),
      },
    });
    if (takeover.count !== 1) {
      const latest = await this.findBootstrap(deviceSessionId);
      if (!latest) throw this.retryable('Onboarding bootstrap claim disappeared; retry');
      return { record: latest, fence: null, previous: null };
    }
    return {
      record: {
        ...existing,
        status: 'running',
        executionId: nextFence.executionId,
        generation: nextFence.generation,
        leaseExpiresAt: this.newLease(),
      },
      fence: nextFence,
      previous: existing,
    };
  }

  private async recoverPreviousExecution(
    context: OnboardingPrincipal,
    plan: NormalizedServerPlan,
    claim: Claim & { fence: ExecutionFence },
    resources: BootstrapResources,
  ): Promise<OnboardBootstrapResponse | null> {
    const previous = claim.previous;
    if (!previous?.executionId) return null;
    const previousFence = {
      executionId: previous.executionId,
      generation: previous.generation,
    };
    const previousKey = this.replayKey(previous.id, previousFence);

    if (previous.status === 'failed') {
      await this.renew(claim.record.id, claim.fence);
      await this.redis.deleteStrict(previousKey);
      await this.revokePreviousPending(context.userId, claim, resources);
      return null;
    }

    let serialized: string | null;
    try {
      serialized = await this.redis.getStrict(previousKey);
    } catch {
      throw new AmbiguousReplayStateError();
    }
    if (!serialized) {
      await this.revokePreviousPending(context.userId, claim, resources);
      return null;
    }

    let response: OnboardBootstrapResponse;
    try {
      response = this.parseReplay(serialized);
      this.assertRecoveredReplay(response, resources, plan.scopes);
    } catch {
      await this.renew(claim.record.id, claim.fence);
      await this.redis.deleteStrict(previousKey);
      await this.revokePreviousPending(context.userId, claim, resources);
      return null;
    }

    const canonical = JSON.stringify(response);
    const resultHash = this.hash(canonical);
    await this.renew(claim.record.id, claim.fence);
    const copied = await this.storeReplayWithReadback(
      claim.record.id,
      claim.fence,
      canonical,
      resultHash,
    );
    if (!copied) throw new AmbiguousReplayStateError();
    await this.renew(claim.record.id, claim.fence);
    await this.redis.deleteStrict(previousKey);
    const completion = await this.prisma.onboardingBootstrap.updateMany({
      where: this.runningFenceWhere(claim.record.id, claim.fence),
      data: { status: 'completed', resultHash, leaseExpiresAt: null },
    });
    if (completion.count !== 1) throw new LostBootstrapOwnershipError();
    await this.consumeToken(context.sessionId, claim.fence);
    return response;
  }

  private async revokePreviousPending(
    ownerId: string,
    claim: Claim & { fence: ExecutionFence },
    resources: BootstrapResources,
  ): Promise<void> {
    if (!resources.ids.pendingInstallationId) return;
    await this.renew(claim.record.id, claim.fence);
    try {
      await this.installations.revoke(
        ownerId,
        resources.agent.id,
        resources.ids.pendingInstallationId,
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    resources.ids = this.withoutPendingInstallation(resources.ids);
    await this.persistResourceIds(claim.record.id, claim.fence, resources.ids);
  }

  private async readCompletedReplay(
    record: BootstrapRecord,
    sessionId: string,
  ): Promise<OnboardBootstrapResponse> {
    if (!record.executionId || !record.resultHash) {
      throw this.retryable('Completed onboarding result is unavailable');
    }
    const fence = { executionId: record.executionId, generation: record.generation };
    let serialized: string | null;
    try {
      serialized = await this.redis.getStrict(this.replayKey(record.id, fence));
    } catch {
      throw this.retryable('Completed onboarding result is temporarily unavailable');
    }
    if (!serialized) throw this.retryable('Completed onboarding result is unavailable');
    const response = this.parseReplay(serialized);
    if (this.hash(JSON.stringify(response)) !== record.resultHash) {
      throw new BusinessException(
        'ONBOARDING_REPLAY_MISMATCH',
        'Saved onboarding result is inconsistent',
      );
    }
    await this.consumeToken(sessionId, fence);
    return response;
  }

  private async waitForWinner(
    deviceSessionId: string,
    idempotencyKeyHash: string,
    serverPlanHash: string,
  ): Promise<OnboardBootstrapResponse | null> {
    const deadline = Date.now() + LOSER_WAIT_MS;
    let delay = INITIAL_BACKOFF_MS;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      await this.pause(Math.min(delay, remaining));
      const latest = await this.findBootstrap(deviceSessionId);
      if (!latest || !this.sameRequest(latest, deviceSessionId, idempotencyKeyHash, serverPlanHash)) {
        throw new BusinessException('ONBOARDING_REPLAY_MISMATCH');
      }
      if (latest.status === 'completed') {
        return this.readCompletedReplay(latest, deviceSessionId);
      }
      if (latest.status === 'failed') return null;
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
    return null;
  }

  private async createResources(
    bootstrapId: string,
    fence: ExecutionFence,
    userId: string,
    deviceSessionId: string,
    plan: NormalizedServerPlan,
  ): Promise<BootstrapResources> {
    return this.prisma.$transaction(async (tx) => {
      const space = plan.space.mode === 'create'
        ? await tx.space.create({
          data: {
            name: plan.space.name,
            slug: `${this.slugify(plan.space.name) || 'space'}-${this.hash(deviceSessionId).slice(0, 16)}`,
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

      const agent = await tx.agent.create({
        data: { ownerId: userId, name: plan.agentName, approvalMode: plan.approvalMode },
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
      const ids: ResourceIds = { spaceId: space.id, agentId: agent.id, grantId: grant.id };
      const persisted = await tx.onboardingBootstrap.updateMany({
        where: this.runningFenceWhere(bootstrapId, fence),
        data: { resourceIds: ids as Prisma.InputJsonValue },
      });
      if (persisted.count !== 1) throw new LostBootstrapOwnershipError();
      return {
        ids,
        space: { id: space.id, name: space.name },
        agent: { id: agent.id, name: agent.name },
        grant: { id: grant.id, role: 'editor' as const, scopes: [...plan.scopes] },
      };
    });
  }

  private async loadResources(
    ids: ResourceIds,
    userId: string,
    plan: NormalizedServerPlan,
  ): Promise<BootstrapResources> {
    const space = await this.prisma.space.findFirst({
      where: {
        id: ids.spaceId,
        deletedAt: null,
        members: { some: { userId, role: { in: ['owner', 'admin'] } } },
      },
    });
    if (!space) throw new BusinessException('SPACE_ACCESS_DENIED');
    if (
      (plan.space.mode === 'create' && space.approvalPolicy !== plan.approvalMode)
      || (plan.space.mode === 'existing'
        && plan.approvalMode === 'scoped-auto-publish'
        && space.approvalPolicy !== 'scoped-auto-publish')
    ) {
      throw new BusinessException(
        'RESOURCE_CONFLICT',
        'Existing Space policy does not allow scoped auto-publish',
      );
    }

    const [agent, grant] = await Promise.all([
      this.prisma.agent.findUnique({ where: { id: ids.agentId } }),
      this.prisma.agentGrant.findUnique({ where: { id: ids.grantId } }),
    ]);
    if (
      !agent
      || agent.ownerId !== userId
      || agent.name !== plan.agentName
      || agent.approvalMode !== plan.approvalMode
      || agent.status !== 'active'
      || agent.revokedAt
      || !grant
      || grant.agentId !== ids.agentId
      || grant.spaceId !== ids.spaceId
      || grant.role !== 'editor'
      || !this.sameScopes(grant.scopes, plan.scopes)
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

  private async storeReplayWithReadback(
    bootstrapId: string,
    fence: ExecutionFence,
    serialized: string,
    expectedHash: string,
  ): Promise<boolean> {
    const key = this.replayKey(bootstrapId, fence);
    try {
      await this.redis.setStrict(key, serialized, REPLAY_TTL_SECONDS);
      return true;
    } catch {
      let readBack: string | null;
      try {
        readBack = await this.redis.getStrict(key);
      } catch {
        throw new AmbiguousReplayStateError();
      }
      if (!readBack) return false;
      try {
        const sanitized = this.parseReplay(readBack);
        if (this.hash(JSON.stringify(sanitized)) === expectedHash) return true;
      } catch {
        // A definite mismatch is safe to clean up under the current fence.
      }
      await this.renew(bootstrapId, fence);
      await this.redis.deleteStrict(key);
      return false;
    }
  }

  private async renew(bootstrapId: string, fence: ExecutionFence): Promise<void> {
    const now = new Date();
    const renewed = await this.prisma.onboardingBootstrap.updateMany({
      where: {
        ...this.runningFenceWhere(bootstrapId, fence),
        leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt: new Date(now.getTime() + EXECUTION_LEASE_MS) },
    });
    if (renewed.count !== 1) throw new LostBootstrapOwnershipError();
  }

  private async persistResourceIds(
    bootstrapId: string,
    fence: ExecutionFence,
    ids: ResourceIds,
  ): Promise<void> {
    const persisted = await this.prisma.onboardingBootstrap.updateMany({
      where: this.runningFenceWhere(bootstrapId, fence),
      data: { resourceIds: ids as Prisma.InputJsonValue },
    });
    if (persisted.count !== 1) throw new LostBootstrapOwnershipError();
  }

  private async persistResourceIdsBestEffort(
    bootstrapId: string,
    fence: ExecutionFence,
    ids: ResourceIds,
  ): Promise<void> {
    try {
      await this.persistResourceIds(bootstrapId, fence, ids);
    } catch {
      // A newer generation owns recovery state.
    }
  }

  private async markFailed(bootstrapId: string, fence: ExecutionFence): Promise<void> {
    try {
      await this.prisma.onboardingBootstrap.updateMany({
        where: this.runningFenceWhere(bootstrapId, fence),
        data: { status: 'failed', leaseExpiresAt: null },
      });
    } catch {
      // Preserve the original error; stale ownership cannot change newer state.
    }
  }

  private async consumeToken(sessionId: string, fence: ExecutionFence): Promise<void> {
    const consumed = await this.prisma.onboardingDeviceSession.updateMany({
      where: {
        id: sessionId,
        tokenConsumedAt: null,
        bootstrap: {
          is: {
            executionId: fence.executionId,
            generation: fence.generation,
            status: 'completed',
          },
        },
      },
      data: { tokenConsumedAt: new Date() },
    });
    if (consumed.count === 0) {
      const current = await this.findBootstrap(sessionId);
      if (
        !current
        || current.status !== 'completed'
        || current.executionId !== fence.executionId
        || current.generation !== fence.generation
      ) throw new LostBootstrapOwnershipError();
    }
  }

  private async deleteOwnedReplayBestEffort(
    bootstrapId: string,
    fence: ExecutionFence,
  ): Promise<void> {
    try {
      await this.renew(bootstrapId, fence);
      await this.redis.deleteStrict(this.replayKey(bootstrapId, fence));
    } catch {
      // Keep uncertain state fenced for a later exact recovery.
    }
  }

  private async revokeBestEffort(
    ownerId: string,
    agentId: string,
    installationId: string,
  ): Promise<boolean> {
    try {
      await this.installations.revoke(ownerId, agentId, installationId);
      return true;
    } catch {
      return false;
    }
  }

  private response(
    resources: BootstrapResources,
    scopes: string[],
    installation: { code: string; installationId: string; expiresAt: string },
  ): OnboardBootstrapResponse {
    return {
      space: resources.space,
      agent: resources.agent,
      grant: { role: 'editor', scopes: [...scopes] },
      installation: {
        code: installation.code,
        installationId: installation.installationId,
        expiresAt: installation.expiresAt,
      },
    };
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

  private assertRecoveredReplay(
    response: OnboardBootstrapResponse,
    resources: BootstrapResources,
    scopes: string[],
  ): void {
    if (
      response.space.id !== resources.ids.spaceId
      || response.agent.id !== resources.ids.agentId
      || response.grant.role !== 'editor'
      || response.grant.scopes.length !== scopes.length
      || response.grant.scopes.some((scope, index) => scope !== scopes[index])
      || response.installation.installationId !== resources.ids.pendingInstallationId
    ) {
      throw new BusinessException('RESOURCE_CONFLICT', 'Stale onboarding replay is inconsistent');
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

  private withoutPendingInstallation(ids: ResourceIds): ResourceIds {
    return { spaceId: ids.spaceId, agentId: ids.agentId, grantId: ids.grantId };
  }

  private sameScopes(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((scope, index) => scope === sortedRight[index]);
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
      || context.packageVersion !== '0.3.7'
      || context.purpose !== 'full-onboarding'
      || capabilities.length !== REQUIRED_CAPABILITIES.length
      || capabilities.some((capability, index) => capability !== REQUIRED_CAPABILITIES[index])
    ) throw new BusinessException('ONBOARDING_PLAN_HASH_MISMATCH');
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

  private canTakeOver(record: BootstrapRecord): boolean {
    return record.status === 'failed'
      || (record.status === 'running'
        && (!record.leaseExpiresAt || record.leaseExpiresAt.getTime() <= Date.now()));
  }

  private runningFenceWhere(bootstrapId: string, fence: ExecutionFence) {
    return {
      id: bootstrapId,
      status: 'running',
      executionId: fence.executionId,
      generation: fence.generation,
    } as const;
  }

  private async findBootstrap(deviceSessionId: string): Promise<BootstrapRecord | null> {
    return this.prisma.onboardingBootstrap.findUnique({
      where: { deviceSessionId },
    }) as Promise<BootstrapRecord | null>;
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

  private replayKey(bootstrapId: string, fence: ExecutionFence): string {
    return `onboarding:bootstrap-result:${bootstrapId}:${fence.generation}:${fence.executionId}`;
  }

  private newLease(): Date {
    return new Date(Date.now() + EXECUTION_LEASE_MS);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private isUniqueConstraint(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === 'P2002';
  }

  private retryable(message: string): BusinessException {
    return new BusinessException('RESOURCE_CONFLICT', message);
  }

  private pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
