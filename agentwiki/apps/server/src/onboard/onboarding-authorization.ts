import type { Prisma } from '@prisma/client';
import { BusinessException } from '../core/filters/business-error';
import type { OnboardingPrincipal } from './onboarding-token.guard';

// Mutating callers hold the User lock, which also serializes personal Key rotation.
export async function assertCurrentOnboardingAuthorization(
  tx: Prisma.TransactionClient,
  context: OnboardingPrincipal,
): Promise<void> {
  if (!context.tokenHash) throw new BusinessException('AUTH_EXPIRED');
  const session = await tx.onboardingDeviceSession.findFirst({
    where: {
      id: context.sessionId,
      authorizedUserId: context.userId,
      purpose: context.purpose,
      status: 'authorized',
      onboardingTokenHash: context.tokenHash,
      tokenExpiresAt: { gt: new Date() },
      authorizedUser: { type: 'human', deletedAt: null, lockedAt: null },
    },
    select: { id: true },
  });
  if (!session) throw new BusinessException('AUTH_EXPIRED');
}
