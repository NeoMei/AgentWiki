import type { Prisma } from '@prisma/client';
import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import type { SpaceRole } from '../core/authorization/authorization.service';

export const HUMAN_ROLE_ORDER: SpaceRole[] = ['viewer', 'editor', 'admin', 'owner'];

export function rolesAtLeast(minimumRole: string): SpaceRole[] {
  const minimum = HUMAN_ROLE_ORDER.indexOf(minimumRole as SpaceRole);
  return minimum < 0 ? [] : HUMAN_ROLE_ORDER.slice(minimum);
}

export async function reviewerMemberIssues(
  tx: Pick<Prisma.TransactionClient, 'spaceMember'>,
  spaceId: string,
  definition: CollaborationTemplateDefinition,
) {
  const reviewNodes = definition.nodes.filter((node) => node.kind === 'human_review');
  const reviewerIds = [...new Set(reviewNodes.flatMap((node) => node.reviewerUserIds))];
  if (!reviewerIds.length) return [];
  const members = await tx.spaceMember.findMany({
    where: {
      spaceId,
      userId: { in: reviewerIds },
      user: { type: 'human', deletedAt: null, lockedAt: null },
    },
    select: { userId: true, role: true },
  });
  const membersById = new Map(members.map((member) => [member.userId, member.role]));
  return reviewNodes.flatMap((node) => node.reviewerUserIds.flatMap((userId) => {
    const role = membersById.get(userId);
    if (!role) {
      return [{ code: 'REVIEWER_NOT_SPACE_MEMBER', path: `nodes.${node.id}.reviewerUserIds`, message: userId }];
    }
    if (!rolesAtLeast(node.minimumRole).includes(role as SpaceRole)) {
      return [{ code: 'REVIEWER_ROLE_TOO_LOW', path: `nodes.${node.id}.reviewerUserIds`, message: userId }];
    }
    return [];
  }));
}
