import { SourceService } from './source.service';

// Replace persistence only; exercise the public SourceService read paths.
function fixture() {
  const sources: any[] = [
    { id: 'sa', spaceId: 'a', currentSourceVersionId: 'va', config: { permitted: true } },
    { id: 'sa2', spaceId: 'a', currentSourceVersionId: null },
    { id: 'sb', spaceId: 'b', currentSourceVersionId: 'vb', config: { secret: 'SECRET B' } },
  ];
  const versions: any[] = [{ id: 'va', sourceId: 'sa' }, { id: 'old', sourceId: 'sa' }, { id: 'va2', sourceId: 'sa2' }, { id: 'vb', sourceId: 'sb' }];
  const evidence: any = { id: 'ea', runId: 'ra', sourceVersionId: 'va', quote: 'permitted quote', location: { path: 'a.md' } };
  const run: any = { id: 'ra', spaceId: 'a', sourceId: 'sa', inputSourceVersionId: 'va', inputSourceGeneration: 1,
    status: 'completed', source: sources[0], result: { sourceVersionId: 'va' },
    artifacts: [{ id: 'artifact', runId: 'ra', content: 'permitted artifact' }], evidences: [evidence],
    changeSet: { id: 'ca', runId: 'ra', spaceId: 'a', status: 'pending_review', items: [
      { id: 'item', changeSetId: 'ca', type: 'create_page', payload: { sourceId: 'sa', sourceVersionId: 'va', content: 'permitted body', before: { sourceId: 'sa', sourceVersionId: 'old' } } },
      { id: 'relation', changeSetId: 'ca', type: 'create_relation', payload: { sourcePath: 'a.md', evidenceId: 'ea' } },
    ] },
  };
  const selectIds = (rows: any[], args: any) => rows.filter(row => args.where.id.in.includes(row.id));
  const prisma: any = {
    source: {
      findMany: jest.fn(async (args: any) => selectIds(sources, args)),
      findUnique: jest.fn(async () => ({ ...sources[0], versions: versions.filter(v => v.sourceId === 'sa'), runs: [run] })),
    },
    sourceVersion: { findMany: jest.fn(async (args: any) => selectIds(versions, args).map(v => ({ ...v, source: sources.find(s => s.id === v.sourceId) }))) },
    evidence: { findMany: jest.fn(async (args: any) => selectIds([evidence], args).map(e => ({ ...e, run, sourceVersion: { ...versions.find(v => v.id === e.sourceVersionId), source: sources.find(s => s.id === versions.find(v => v.id === e.sourceVersionId)?.sourceId) } }))) },
    ingestRun: { findUnique: jest.fn(async () => run), findMany: jest.fn(async () => [run]) },
  };
  return { sources, versions, run, prisma, service: new SourceService(prisma, {} as any, {} as any, {} as any, {} as any) };
}

describe('SourceService Run read association boundaries', () => {
  const corruptions: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ['Run Source belongs to another Space', f => { f.run.sourceId = 'sb'; f.run.source = f.sources[2]; }],
    ['Run input version belongs to another Source', f => { f.run.inputSourceVersionId = 'vb'; }],
    ['Source head points to a foreign version', f => { f.sources[0].currentSourceVersionId = 'vb'; }],
    ['Evidence version belongs to another Source', f => { f.run.evidences[0].sourceVersionId = 'vb'; f.run.evidences[0].quote = 'SECRET B'; }],
    ['Evidence disagrees with the fixed Run input', f => { f.run.evidences[0].sourceVersionId = 'old'; }],
    ['ChangeSet belongs to another Space', f => { f.run.changeSet.spaceId = 'b'; }],
    ['result points to a foreign version', f => { f.run.result.sourceVersionId = 'vb'; }],
    ['payload source belongs to another Space', f => { f.run.changeSet.items[0].payload.sourceId = 'sb'; }],
    ['payload version belongs to another Space', f => { f.run.changeSet.items[0].payload.sourceVersionId = 'vb'; }],
    ['nested before version belongs to another Space', f => { f.run.changeSet.items[0].payload.before.sourceVersionId = 'vb'; }],
    ['payload evidence cannot be resolved', f => { f.run.changeSet.items[1].payload.evidenceId = 'foreign-evidence'; }],
  ];
  it.each(corruptions)('does not disclose detail when %s', async (_name, corrupt) => {
    const f = fixture(); corrupt(f);
    await expect(f.service.getRun('ra')).rejects.toMatchObject({ status: 404 });
  });
  it.each(corruptions.slice(0, 3).concat([corruptions[5], corruptions[6]]))('filters a list row when %s', async (_name, corrupt) => {
    const f = fixture(); corrupt(f);
    await expect(f.service.listRuns('a')).resolves.toEqual([]);
  });

  it('validates the returned Source snapshot even if a later identity read has a repaired head', async () => {
    const f = fixture(); f.run.source = { ...f.sources[0], currentSourceVersionId: 'vb' };
    await expect(f.service.getRun('ra')).rejects.toMatchObject({ status: 404 });
  });
  it('preserves authorized details including historical before and relation evidence', async () => {
    const f = fixture();
    const result = await f.service.getRun('ra');
    expect(result.source.config).toEqual({ permitted: true });
    expect(result.evidences[0].quote).toBe('permitted quote');
    expect(result.changeSet!.items[0].payload).toMatchObject({ content: 'permitted body', before: { sourceVersionId: 'old' } });
    expect(result.changeSet!.items[1].payload).toEqual({ sourcePath: 'a.md', evidenceId: 'ea' });
    expect(result.artifacts[0].content).toBe('permitted artifact');
  });
  it('preserves legacy null input and generation with historical versions', async () => {
    const f = fixture(); f.run.inputSourceVersionId = null; f.run.inputSourceGeneration = null;
    f.run.evidences[0].sourceVersionId = 'old'; f.run.result.sourceVersionId = 'old';
    await expect(f.service.getRun('ra')).resolves.toMatchObject({ id: 'ra', inputSourceGeneration: null });
  });
  it('permits structured payload references to other authorized sources in the same Space', async () => {
    const f = fixture(); f.run.changeSet.items[0].payload = { sourceId: 'sa2', sourceVersionId: 'va2', content: 'same Space' };
    await expect(f.service.getRun('ra')).resolves.toMatchObject({ id: 'ra' });
  });
  it('filters a foreign-Space Run from Source details while retaining historical versions', async () => {
    const f = fixture(); f.run.spaceId = 'b';
    const source = await f.service.get('sa');
    expect(source.runs).toEqual([]);
    expect(source.versions.map((v: any) => v.id)).toEqual(['va', 'old']);
  });
});
