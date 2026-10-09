import { Injectable } from '@nestjs/common';
import type { PageSourceStatus } from '@agentwiki/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService, type Principal } from '../authorization/authorization.service';
import { getBusinessCode } from '../filters/business-error';

export interface SourceBindingSnapshot {
  spaceId: string;
  sourceId: string | null;
  sourceVersionId: string | null;
  sourceGeneration: number | null;
}
export interface SourceBoundPageSnapshot extends SourceBindingSnapshot { id: string }
type Row = Record<string, any>;
type Context = { sources: Map<string, Row>; versions: Map<string, Row>; runs: Map<string, Row>; allowed: Set<string> };
const unavailable = (): PageSourceStatus => ({ status: 'unavailable', reason: 'source_unavailable' });
const positive = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const SOURCE_KEYS = ['sourceId', 'sourceVersionId', 'sourceGeneration', 'sourcePath', 'sourceChangeSetId'];
const versionIdentitySelect = { id: true, sourceId: true, version: true };
const versionSelect = { ...versionIdentitySelect, metadata: true, files: { take: 3, orderBy: { path: 'asc' as const }, select: { path: true } } };
export const EVIDENCE_READ_FIELDS = { id: true, runId: true, sourceVersionId: true, quote: true, location: true, confidence: true };
const denial = (error: unknown) => ['SPACE_ACCESS_DENIED', 'SPACE_NOT_FOUND', 'RESOURCE_NOT_FOUND', 'AUTH_SCOPE_REQUIRED'].includes(getBusinessCode(error) ?? '');
const binding = (row: Row, spaceId: string): SourceBindingSnapshot => ({ spaceId, sourceId: row?.sourceId ?? null, sourceVersionId: row?.sourceVersionId ?? null, sourceGeneration: row?.sourceGeneration ?? null });
const runBinding = (run: Row): SourceBindingSnapshot => ({ spaceId: run.spaceId, sourceId: run.sourceId, sourceVersionId: run.inputSourceVersionId, sourceGeneration: run.inputSourceGeneration });
const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));

/** Read-only leaf. Callers authorize the Page/Review/graph; source authorization is independent. */
@Injectable()
export class SourceFreshnessService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  private async many(model: 'source' | 'sourceVersion' | 'ingestRun' | 'changeSet', ids: Array<string | null | undefined>, select: Row): Promise<Row[]> {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const rows: Row[] = [];
    for (let i = 0; i < unique.length; i += 200) rows.push(...await (this.prisma[model] as any).findMany({ where: { id: { in: unique.slice(i, i + 200) } }, select }));
    return rows;
  }

  private async context(bindings: SourceBindingSnapshot[], evidences: Row[], runIds: string[], principal: Principal): Promise<Context> {
    if (!principal?.userId) throw new Error('Source projection requires Principal');
    const runs = await this.many('ingestRun', [...runIds, ...evidences.map(e => e.runId)], { id: true, spaceId: true, sourceId: true, inputSourceVersionId: true, inputSourceGeneration: true });
    const evidenceVersionIds = new Set<string>(evidences.map(e => e.sourceVersionId));
    const versions = [
      ...await this.many('sourceVersion', [...bindings.map(b => b.sourceVersionId), ...runs.map(r => r.inputSourceVersionId)].filter(id => !evidenceVersionIds.has(id)), versionIdentitySelect),
      ...await this.many('sourceVersion', [...evidenceVersionIds], versionSelect),
    ];
    const sources = await this.many('source', [...bindings.map(b => b.sourceId), ...versions.map(v => v.sourceId), ...runs.map(r => r.sourceId)], { id: true, spaceId: true, name: true, type: true, status: true, archivedAt: true, currentSourceVersionId: true, currentSourceGeneration: true });
    const knownVersions = new Set(versions.map(v => v.id));
    versions.push(...await this.many('sourceVersion', sources.map(s => s.currentSourceVersionId).filter(id => !knownVersions.has(id)), versionIdentitySelect));
    const allowed = new Set<string>();
    let personalAllowed = true;
    try { await this.authorization.assertPersonalSourceRead(principal); } catch (error) { if (!denial(error)) throw error; personalAllowed = false; }
    if (personalAllowed) {
      const spaces = new Set(bindings.map(b => b.spaceId));
      for (const spaceId of spaces) {
        if (!sources.some(source => source.spaceId === spaceId)) continue;
        try {
          await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
          allowed.add(spaceId);
        } catch (error) { if (!denial(error)) throw error; }
      }
    }
    return { sources: new Map(sources.map(s => [s.id, s])), versions: new Map(versions.map(v => [v.id, v])), runs: new Map(runs.map(r => [r.id, r])), allowed };
  }

  private source(b: SourceBindingSnapshot, ctx: Context): Row | null {
    const source = b.sourceId ? ctx.sources.get(b.sourceId) : undefined;
    if (!source || source.spaceId !== b.spaceId || !ctx.allowed.has(b.spaceId)) return null;
    if (b.sourceVersionId && ctx.versions.get(b.sourceVersionId)?.sourceId !== source.id) return null;
    if (source.currentSourceVersionId && ctx.versions.get(source.currentSourceVersionId)?.sourceId !== source.id) return null;
    return source;
  }

  private compare(b: SourceBindingSnapshot, ctx: Context): PageSourceStatus {
    if (!b.sourceId) return { status: 'untracked', reason: 'no_source' };
    const source = this.source(b, ctx);
    if (!source) return unavailable();
    const fields = {
      sourceId: source.id,
      ...(b.sourceVersionId ? { reviewedSourceVersionId: b.sourceVersionId, reviewedSourceVersion: ctx.versions.get(b.sourceVersionId)?.version } : {}),
      ...(source.currentSourceVersionId ? { currentSourceVersionId: source.currentSourceVersionId, currentSourceVersion: ctx.versions.get(source.currentSourceVersionId)?.version } : {}),
      ...(positive(b.sourceGeneration) ? { reviewedSourceGeneration: b.sourceGeneration } : {}),
      ...(positive(source.currentSourceGeneration) ? { currentSourceGeneration: source.currentSourceGeneration } : {}),
    };
    if (source.status !== 'active' || source.archivedAt) return { ...fields, ...unavailable() };
    if (!source.currentSourceVersionId || !positive(source.currentSourceGeneration) || !b.sourceVersionId) return { ...fields, status: 'unknown', reason: 'unverified_source' };
    if (!positive(b.sourceGeneration)) return { ...fields, status: 'needs_review', reason: 'page_changed' };
    if (b.sourceVersionId !== source.currentSourceVersionId || b.sourceGeneration !== source.currentSourceGeneration) return { ...fields, status: 'needs_review', reason: 'source_changed' };
    return { ...fields, status: 'current', reason: 'reviewed_source' };
  }

  async forPages(pages: SourceBoundPageSnapshot[], principal: Principal): Promise<Map<string, PageSourceStatus>> {
    const ctx = await this.context(pages, [], [], principal);
    return new Map(pages.map(p => [p.id, this.compare(p, ctx)]));
  }

  private evidence(e: Row, b: SourceBindingSnapshot, ctx: Context): Row | null {
    const version = ctx.versions.get(e.sourceVersionId);
    const run = ctx.runs.get(e.runId);
    if (!version || !run || run.spaceId !== b.spaceId || run.sourceId !== version.sourceId || (run.inputSourceVersionId && run.inputSourceVersionId !== version.id)) return null;
    const source = this.source({ ...b, sourceId: version.sourceId, sourceVersionId: version.id }, ctx);
    if (!source) return null;
    const location: Row = {};
    for (const key of ['path', 'sourcePath', 'url', 'startLine', 'endLine', 'line', 'page', 'heading']) {
      const value = e.location?.[key];
      // URLs may contain embedded credentials. Source paths and scalar locations suffice.
      if (key !== 'url' && (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) location[key] = value;
    }
    const evidenceState = b.sourceId && run.inputSourceVersionId === version.id && positive(run.inputSourceGeneration)
      ? b.sourceId === source.id && b.sourceVersionId === version.id && b.sourceGeneration === run.inputSourceGeneration ? 'published_basis' : 'historical'
      : 'unknown';
    return { ...pick(e, ['id', 'quote', 'confidence']), location, evidenceState,
      sourceVersion: { id: version.id, version: version.version, source: pick(source, ['id', 'name', 'type']),
        files: (version.files ?? []).slice(0, 3).map((file: Row) => ({ path: file.path })),
        metadata: typeof version.metadata?.commit === 'string' && /^[a-fA-F0-9]{6,64}$/.test(version.metadata.commit) ? { commit: version.metadata.commit } : {} } };
  }

  async projectEvidence(evidences: Row[], spaceId: string, principal: Principal): Promise<Map<string, Row>> {
    const b = binding({}, spaceId);
    const ctx = await this.context([b], evidences, [], principal);
    return new Map(evidences.flatMap(e => { const result = this.evidence(e, b, ctx); return result ? [[e.id, result]] : []; }));
  }

  async projectGraph(pages: SourceBoundPageSnapshot[], evidences: Row[], principal: Principal) {
    const ctx = await this.context(pages, evidences, [], principal);
    const spaceId = pages[0]?.spaceId;
    if (pages.some(page => page.spaceId !== spaceId)) throw new Error('Graph projection requires one Space');
    const b = binding({}, spaceId);
    return {
      statuses: new Map(pages.map(page => [page.id, this.compare(page, ctx)])),
      evidence: new Map(evidences.flatMap(e => { const result = this.evidence(e, b, ctx); return result ? [[e.id, result]] : []; })),
    };
  }

  private cleanBinding(row: Row, spaceId: string, ctx: Context): Row {
    const result = { ...row };
    if (!this.source(binding(row, spaceId), ctx)) for (const key of SOURCE_KEYS) if (key in result) result[key] = null;
    return result;
  }

  async projectPages<T extends SourceBoundPageSnapshot>(pages: T[], principal: Principal): Promise<Array<T & { sourceStatus: PageSourceStatus } & Row>> {
    const rows = pages as Array<T & Row>;
    const ctx = await this.context(pages, rows.flatMap(p => p.evidence ?? []), rows.map(p => p.provenance?.run?.id).filter(Boolean), principal);
    const changeSets = new Map((await this.many('changeSet', rows.flatMap(page => [page.sourceChangeSetId, page.lastChangeSetId]), { id: true, spaceId: true })).map(row => [row.id, row]));
    return rows.map(page => {
      const result = this.cleanBinding(page, page.spaceId, ctx);
      // FK identity alone is not a same-Space authorization proof, including bare list/search pointers.
      for (const [pointer, detail] of [['sourceChangeSetId', 'provenance'], ['lastChangeSetId', 'lastChange']]) {
        const id = page[pointer];
        const valid = typeof id === 'string' && changeSets.get(id)?.spaceId === page.spaceId;
        if (!valid && pointer in result) result[pointer] = null;
        if (detail in result && (!valid || page[detail]?.id !== id)) result[detail] = null;
      }
      const invalidBinding = !!page.sourceId && !this.source(page, ctx);
      if (page.evidence) result.evidence = invalidBinding ? [] : page.evidence.flatMap((e: Row) => { const value = this.evidence(e, page, ctx); return value ? [value] : []; });
      if (result.provenance) {
        result.provenance = { ...page.provenance, run: null };
        const rawRun = page.provenance.run;
        const run = rawRun && ctx.runs.get(rawRun.id);
        const source = run?.spaceId === page.spaceId ? this.source(runBinding(run), ctx) : null;
        if (source && !invalidBinding) result.provenance.run = { ...pick(rawRun, ['id', 'status', 'stage', 'completedAt']), source: pick(source, ['id', 'name', 'type']) };
      }
      return { ...result, sourceStatus: this.compare(page, ctx) } as T & { sourceStatus: PageSourceStatus } & Row;
    });
  }

  async projectChangeSets(changeSets: Row[], principal: Principal): Promise<Row[]> {
    const bindings = changeSets.flatMap(cs => [binding({}, cs.spaceId), ...(cs.items ?? []).flatMap((item: Row) => [item.payload, item.payload?.before, item.payload?.changes].filter(Boolean).map(row => binding(row, cs.spaceId)))]);
    const evidences = changeSets.flatMap(cs => cs.run?.evidences ?? []);
    const ctx = await this.context(bindings, evidences, changeSets.map(cs => cs.runId ?? cs.run?.id).filter(Boolean), principal);
    return changeSets.map(cs => {
      const hasRun = !!(cs.runId ?? cs.run?.id);
      const run = ctx.runs.get(cs.runId ?? cs.run?.id);
      const source = run && run.spaceId === cs.spaceId ? this.source(runBinding(run), ctx) : null;
      const result: Row = { ...cs, run: null, runId: source ? run!.id : null };
      if (run && source) result.run = { ...pick(cs.run ?? {}, ['id', 'status', 'stage', 'startedAt', 'completedAt', 'createdAt']),
        ...pick(run, ['id', 'spaceId', 'sourceId', 'inputSourceVersionId', 'inputSourceGeneration']), source: pick(source, ['id', 'name', 'type']),
        evidences: (cs.run?.evidences ?? []).flatMap((e: Row) => { const value = this.evidence(e, binding({}, cs.spaceId), ctx); return value ? [value] : []; }) };
      result.sourceStatus = run ? source ? this.compare(runBinding(run), ctx) : unavailable() : hasRun ? unavailable() : this.compare(binding({}, cs.spaceId), ctx);
      const visibleEvidence = new Set((result.run?.evidences ?? []).map((e: Row) => e.id));
      result.items = (cs.items ?? []).map((item: Row) => {
        const raw = item.payload ?? {};
        const payload = this.cleanBinding(raw, cs.spaceId, ctx);
        for (const key of ['before', 'changes']) if (raw[key] && typeof raw[key] === 'object') payload[key] = this.cleanBinding(raw[key], cs.spaceId, ctx);
        for (const row of [payload, payload.before, payload.changes].filter(Boolean)) {
          if ('evidenceId' in row && !visibleEvidence.has(row.evidenceId)) row.evidenceId = null;
        }
        const relationOnly = item.type === 'create_relation' || item.type === 'archive_relation';
        if (relationOnly && !raw.sourceId && 'sourcePath' in raw) payload.sourcePath = raw.sourcePath;
        let status = this.compare(binding(raw, cs.spaceId), ctx);
        if (hasRun) {
          const coherent = run && source && (relationOnly || (raw.sourceId === run.sourceId && raw.sourceVersionId === run.inputSourceVersionId && raw.sourceGeneration === run.inputSourceGeneration));
          status = coherent ? this.compare(runBinding(run!), ctx) : unavailable();
          if (!coherent) for (const row of [payload, payload.before, payload.changes].filter(Boolean)) {
            for (const key of [...SOURCE_KEYS, 'evidenceId']) if (key in row) row[key] = null;
          }
        }
        if (!hasRun && raw.sourceId && status.status !== 'unavailable') status = { ...status, status: 'unknown', reason: 'unverified_source' };
        return { ...item, payload, sourceStatus: status };
      });
      return result;
    });
  }
}
