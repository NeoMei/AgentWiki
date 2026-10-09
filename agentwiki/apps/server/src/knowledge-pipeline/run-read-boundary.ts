import type { PrismaService } from '../database/prisma.service';

type Row = Record<string, any>;
const payloadRows = (run: Row): Row[] => (run.changeSet?.items ?? []).flatMap((item: Row) =>
  [item.payload, item.payload?.before, item.payload?.changes].filter(row => row && typeof row === 'object' && !Array.isArray(row)));

/** Check only stored business associations, never scan user text for identifiers.
 * The caller has already authorized the Run's Space. A foreign FK is not that proof.
 */
export async function coherentRunReads<T extends Row>(prisma: PrismaService, runs: T[], expectedSpaceId?: string): Promise<T[]> {
  if (!runs.length) return [];
  const many = async (model: 'source' | 'sourceVersion' | 'evidence', ids: unknown[], select: Row): Promise<Row[]> => {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const rows: Row[] = [];
    for (let i = 0; i < unique.length; i += 200) {
      rows.push(...await (prisma[model] as any).findMany({ where: { id: { in: unique.slice(i, i + 200) } }, select }));
    }
    return rows;
  };
  const payloads = runs.flatMap(payloadRows);
  const sources = new Map((await many('source', [...runs.map(r => r.sourceId), ...payloads.map(p => p.sourceId)],
    { id: true, spaceId: true, currentSourceVersionId: true })).map(s => [s.id, s]));
  const versions = new Map((await many('sourceVersion', [
    ...runs.flatMap(r => [r.inputSourceVersionId, r.source?.currentSourceVersionId, r.result?.sourceVersionId, ...(r.evidences ?? []).map((e: Row) => e.sourceVersionId)]),
    ...[...sources.values()].map(s => s.currentSourceVersionId), ...payloads.map(p => p.sourceVersionId),
  ], { id: true, sourceId: true, source: { select: { spaceId: true } } })).map(v => [v.id, v]));
  const evidences = new Map((await many('evidence', payloads.map(p => p.evidenceId), {
    id: true, runId: true, sourceVersionId: true,
    run: { select: { id: true, spaceId: true, sourceId: true, inputSourceVersionId: true } },
    sourceVersion: { select: { id: true, sourceId: true, source: { select: { spaceId: true } } } },
  })).map(e => [e.id, e]));
  const sameSourceVersion = (id: unknown, sourceId: string) => !id || versions.get(id as string)?.sourceId === sourceId;
  return runs.filter(run => {
    const source = sources.get(run.sourceId);
    if (!source || source.spaceId !== run.spaceId || (expectedSpaceId && run.spaceId !== expectedSpaceId)) return false;
    // Fixed input and the returned Source head must belong to this Source. Null inputs
    // and old versions remain readable: freshness is not a read authorization rule.
    if (!sameSourceVersion(run.inputSourceVersionId, source.id) || !sameSourceVersion(source.currentSourceVersionId, source.id) || !sameSourceVersion(run.source?.currentSourceVersionId, source.id)
      || !sameSourceVersion(run.result?.sourceVersionId, source.id)) return false;
    if (run.source && (run.source.id !== source.id || (run.source.spaceId && run.source.spaceId !== run.spaceId))) return false;
    if ((run.artifacts ?? []).some((a: Row) => a.runId !== run.id)) return false;
    if ((run.evidences ?? []).some((e: Row) => e.runId !== run.id || !e.sourceVersionId
      || !sameSourceVersion(e.sourceVersionId, source.id) || (run.inputSourceVersionId && e.sourceVersionId !== run.inputSourceVersionId))) return false;
    if (run.changeSet && (run.changeSet.spaceId !== run.spaceId || run.changeSet.runId !== run.id
      || (run.changeSet.items ?? []).some((item: Row) => item.changeSetId !== run.changeSet.id))) return false;
    return payloadRows(run).every(payload => {
      const boundSource = payload.sourceId ? sources.get(payload.sourceId) : undefined;
      if (payload.sourceId && boundSource?.spaceId !== run.spaceId) return false;
      const version = payload.sourceVersionId ? versions.get(payload.sourceVersionId) : undefined;
      if (payload.sourceVersionId && (version?.source?.spaceId !== run.spaceId || (payload.sourceId && version?.sourceId !== payload.sourceId))) return false;
      if (payload.evidenceId) {
        const e = evidences.get(payload.evidenceId);
        if (!e || e.run?.spaceId !== run.spaceId || e.sourceVersion?.source?.spaceId !== run.spaceId
          || e.run.sourceId !== e.sourceVersion.sourceId
          || (e.run.inputSourceVersionId && e.run.inputSourceVersionId !== e.sourceVersionId)) return false;
      }
      return true;
    });
  });
}
