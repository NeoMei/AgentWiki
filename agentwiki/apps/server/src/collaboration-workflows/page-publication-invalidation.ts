import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export async function supersedePendingPagePublicationsLocked(
  tx: Tx,
  input: { spaceId: string; pageIds: string[]; excludeChangeSetId?: string | null },
): Promise<number> {
  if (input.pageIds.length === 0) return 0;
  const links = await tx.collaborationArtifactChangeSetLink.findMany({
    where: { spaceId: input.spaceId, pageId: { in: [...new Set(input.pageIds)] } },
    select: { changeSetId: true },
  });
  const changeSetIds = [...new Set(links.map((link) => link.changeSetId))]
    .filter((id) => id !== input.excludeChangeSetId);
  return supersedeChangeSetsLocked(tx, changeSetIds);
}

export async function supersedeRunPagePublicationsLocked(
  tx: Tx,
  input: { runId: string; taskIds?: string[] },
): Promise<number> {
  const links = await tx.collaborationArtifactChangeSetLink.findMany({
    where: {
      runId: input.runId,
      ...(input.taskIds ? { taskId: { in: [...new Set(input.taskIds)] } } : {}),
    },
    select: { artifactId: true, changeSetId: true },
  });
  const changeSetIds = [...new Set(links.map((link) => link.changeSetId))];
  const artifactIds = [...new Set(links.map((link) => link.artifactId))];
  if (artifactIds.length > 0) {
    await tx.collaborationReview.updateMany({
      where: { runId: input.runId, artifactId: { in: artifactIds }, status: 'pending' },
      data: { status: 'superseded', reason: 'Page publication is no longer valid' },
    });
    await tx.collaborationTaskArtifact.updateMany({
      where: { runId: input.runId, id: { in: artifactIds }, status: { in: ['pending', 'accepted'] } },
      data: { status: 'superseded' },
    });
  }
  return supersedeChangeSetsLocked(tx, changeSetIds);
}

async function supersedeChangeSetsLocked(tx: Tx, changeSetIds: string[]): Promise<number> {
  if (changeSetIds.length === 0) return 0;
  const superseded = await tx.changeSet.updateMany({
    where: {
      id: { in: changeSetIds },
      origin: 'collaboration',
      status: { in: ['draft', 'pending_review', 'approved'] },
    },
    data: { status: 'superseded' },
  });
  if (superseded.count > 0) {
    await tx.changeItem.updateMany({
      where: {
        changeSetId: { in: changeSetIds },
        changeSet: { origin: 'collaboration', status: 'superseded' },
        status: { in: ['pending', 'accepted'] },
      },
      data: { status: 'rejected' },
    });
  }
  return superseded.count;
}
