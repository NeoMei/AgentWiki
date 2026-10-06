import { SourceFreshnessService } from './source-freshness.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { BusinessException } from '../filters/business-error';

const principal = { userId: 'u' };
const page = { id: 'p', spaceId: 's', content: 'Authorized body', sourceId: 'src', sourceVersionId: 'v1', sourceGeneration: 1, sourcePath: 'private/path', sourceChangeSetId: 'cs' };
function setup() {
  const source = { id: 'src', spaceId: 's', name: 'Source', type: 'file', status: 'active', archivedAt: null, currentSourceVersionId: 'v1', currentSourceGeneration: 1 };
  const versions = [{ id: 'v1', sourceId: 'src', version: 1, metadata: { commit: 'abc123', token: 'SECRET' }, files: [1,2,3,4].map(i => ({ path: `file${i}` })) }, { id: 'v2', sourceId: 'src', version: 2 }];
  const run = { id: 'r', spaceId: 's', sourceId: 'src', inputSourceVersionId: 'v1', inputSourceGeneration: 1 };
  const prisma: any = {
    source: { findMany: jest.fn(async () => [source]) },
    sourceVersion: { findMany: jest.fn(async ({ where }: any) => versions.filter(v => where.id.in.includes(v.id))) },
    ingestRun: { findMany: jest.fn(async () => [run]) },
    apiKeyCredential: { findFirst: jest.fn() },
    page: { findMany: jest.fn(() => { throw new Error('Must not reread Page'); }) },
  };
  const authorization: any = { assertSpaceAccess: jest.fn(), assertPersonalSourceRead: jest.fn() };
  return { service: new SourceFreshnessService(prisma, authorization), source, versions, run, prisma, authorization };
}
const evidence = { id: 'e', runId: 'r', sourceVersionId: 'v1', quote: 'Historical quote', location: { path: 'file', startLine: 2, config: 'SECRET' }, confidence: 0.8, sourceVersion: { content: 'SECRET' } };

describe('Source freshness projection', () => {
  it('uses the supplied Page snapshot and matches both version and generation', async () => {
    const { service, prisma } = setup();
    expect((await service.forPages([page], principal)).get('p')).toMatchObject({ status: 'current', reviewedSourceVersionId: 'v1', currentSourceVersion: 1, reviewedSourceGeneration: 1 });
    expect(prisma.page.findMany).not.toHaveBeenCalled();
    expect(prisma.sourceVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, sourceId: true, version: true } }));
  });
  it('distinguishes untracked, unknown, changed source and changed page', async () => {
    const { service, source } = setup();
    expect((await service.forPages([{ ...page, sourceId: null, sourceVersionId: null, sourceGeneration: null }], principal)).get('p')?.status).toBe('untracked');
    source.currentSourceVersionId = null as any;
    expect((await service.forPages([page], principal)).get('p')?.status).toBe('unknown');
    source.currentSourceVersionId = 'v1'; source.currentSourceGeneration = 3;
    expect((await service.forPages([page], principal)).get('p')).toMatchObject({ status: 'needs_review', reason: 'source_changed' });
    expect((await service.forPages([{ ...page, sourceGeneration: null }], principal)).get('p')).toMatchObject({ status: 'needs_review', reason: 'page_changed' });
  });
  it('keeps archived authorized historical evidence but applies the allowlist', async () => {
    const { service, source } = setup(); source.status = 'archived';
    const [result] = await service.projectPages([{ ...page, sourceGeneration: 3, evidence: [evidence] }], principal);
    expect(result.sourceStatus.status).toBe('unavailable');
    expect(result.evidence[0]).toMatchObject({ quote: 'Historical quote', evidenceState: 'historical', sourceVersion: { id: 'v1', version: 1, metadata: { commit: 'abc123' } } });
    expect((result.evidence[0].sourceVersion as any).files).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it.each(['denied', 'cross-space', 'wrong-version-owner', 'wrong-run-space'])('redacts %s without removing authorized body', async kind => {
    const { service, source, versions, run, authorization } = setup();
    if (kind === 'denied') authorization.assertSpaceAccess.mockRejectedValue(new BusinessException('SPACE_ACCESS_DENIED'));
    if (kind === 'cross-space') source.spaceId = 'other';
    if (kind === 'wrong-version-owner') versions[0].sourceId = 'other';
    if (kind === 'wrong-run-space') run.spaceId = 'other';
    const [result] = await service.projectPages([{ ...page, evidence: [evidence], provenance: { id: 'cs', run: { id: 'r', source: { id: 'src' } } } }], principal);
    expect(result.content).toBe(page.content);
    expect(result.evidence).toEqual([]);
    expect(result.provenance?.run).toBeFalsy();
    if (kind !== 'wrong-run-space') {
      expect(result.sourceStatus).toEqual({ status: 'unavailable', reason: 'source_unavailable' });
      for (const key of ['sourceId','sourceVersionId','sourcePath','sourceGeneration','sourceChangeSetId']) expect(result[key]).toBeFalsy();
    }
  });
  it('does not attach an independently valid Run to a corrupt Page binding', async () => {
    const { service, versions } = setup(); versions[1].sourceId = 'other';
    const [result] = await service.projectPages([{ ...page, sourceVersionId: 'v2', evidence: [evidence], provenance: { run: { id: 'r' } } }], principal);
    expect(result.sourceStatus).toEqual({ status: 'unavailable', reason: 'source_unavailable' });
    expect(result.evidence).toEqual([]); expect(result.provenance.run).toBeNull();
  });
  it('preserves authorized legacy-null Evidence as unknown; rejects a nonnull version mismatch', async () => {
    const { service, run } = setup();
    run.inputSourceVersionId = null as any; run.inputSourceGeneration = null as any;
    const [legacy] = await service.projectPages([{ ...page, sourceGeneration: null, evidence: [evidence] }], principal);
    expect(legacy.evidence[0]).toMatchObject({ quote: evidence.quote, evidenceState: 'unknown' });
    run.inputSourceGeneration = 1;
    const [partiallyPinned] = await service.projectPages([{ ...page, evidence: [evidence] }], principal);
    expect((partiallyPinned.evidence[0] as any).evidenceState).toBe('unknown');
    run.inputSourceVersionId = 'v2';
    const [mismatch] = await service.projectPages([{ ...page, evidence: [evidence] }], principal);
    expect(mismatch.evidence).toEqual([]);
  });
  it('redacts denied candidate evidence references in known payload layers while preserving content', async () => {
    const { service, authorization } = setup();
    authorization.assertPersonalSourceRead.mockRejectedValue(new BusinessException('AUTH_SCOPE_REQUIRED'));
    const raw = { id: 'cs', spaceId: 's', runId: 'r', run: { id: 'r', evidences: [evidence] }, items: [{ id: 'i', type: 'update_page', payload: {
      ...page, evidenceId: 'e', before: { ...page, evidenceId: 'e' }, changes: { content: 'sourceId is a term in this authorized body' },
    } }] };
    const [result] = await service.projectChangeSets([raw], principal);
    expect(result.runId).toBeNull(); expect(result.run).toBeNull();
    expect(result.items[0].payload.evidenceId).toBeNull(); expect(result.items[0].payload.before.evidenceId).toBeNull();
    expect(result.items[0].payload.changes.content).toContain('sourceId');
  });
  it('surfaces infrastructure failures and batches shared authorization', async () => {
    const { service, authorization, prisma } = setup();
    await service.forPages(Array.from({ length: 401 }, (_, i) => ({ ...page, id: `p${i}` })), principal);
    expect(authorization.assertSpaceAccess).toHaveBeenCalledTimes(1);
    expect(prisma.source.findMany).toHaveBeenCalledTimes(1);
    authorization.assertSpaceAccess.mockRejectedValue(new Error('database unavailable'));
    await expect(service.forPages([page], principal)).rejects.toThrow('database unavailable');
  });
  it('bounds distinct Source and Version lookups to 200 IDs', async () => {
    const { service, prisma } = setup();
    await service.forPages(Array.from({ length: 401 }, (_, i) => ({ ...page, id: `p${i}`, sourceId: `src${i}`, sourceVersionId: `v${i}` })), principal);
    expect(prisma.source.findMany.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const delegate of [prisma.source, prisma.sourceVersion]) for (const [query] of delegate.findMany.mock.calls) expect(query.where.id.in.length).toBeLessThanOrEqual(200);
  });
  it('does not trust matching source fields from a proposal with no fixed Run', async () => {
    const { service } = setup();
    const cs = { id: 'cs', spaceId: 's', items: [{ id: 'i', type: 'create_page', payload: { ...page } }] };
    const [result] = await service.projectChangeSets([cs], principal);
    expect(result.items[0].sourceStatus.status).toBe('unknown');
  });
  it('projects pinned create candidates without Page IDs and leaves raw business models intact', async () => {
    const { service, source } = setup(); source.currentSourceGeneration = 3;
    const raw = { id: 'cs', spaceId: 's', runId: 'r', run: { id: 'r', source: { config: 'SECRET' }, evidences: [evidence] }, items: [{ id: 'i', type: 'create_page', payload: { ...page, content: 'Candidate body' } }] };
    const [result] = await service.projectChangeSets([raw], principal);
    expect(result.items[0].sourceStatus.status).toBe('needs_review');
    expect(result.items[0].payload.content).toBe('Candidate body');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(raw.run.source.config).toBe('SECRET');
  });
  it('redacts personal pages-only credentials but preserves JWT and authorized PAT', async () => {
    const { prisma } = setup();
    const auth = new AuthorizationService(prisma); jest.spyOn(auth, 'assertSpaceAccess').mockResolvedValue({} as any);
    const service = new SourceFreshnessService(prisma, auth);
    prisma.apiKeyCredential.findFirst.mockResolvedValue({ scopes: ['pages:read'] });
    const [denied] = await service.projectPages([{ ...page, evidence: [evidence], provenance: { run: { id: 'r' } } }], { userId: 'u', credentialId: 'pat' });
    expect(denied.content).toBe(page.content); expect(denied.sourceId).toBeNull(); expect(denied.evidence).toEqual([]); expect(denied.provenance.run).toBeNull();
    for (const scopes of [['*'], ['sources:read']]) {
      prisma.apiKeyCredential.findFirst.mockResolvedValue({ scopes });
      expect((await service.forPages([page], { userId: 'u', credentialId: 'pat' })).get('p')?.status).toBe('current');
    }
    expect((await service.forPages([page], principal)).get('p')?.status).toBe('current');
  });
});
