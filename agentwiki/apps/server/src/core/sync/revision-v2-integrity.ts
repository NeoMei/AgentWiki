import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  normalizeMarkdown,
  treeRevisionContentHashV2,
  treeRevisionDeltaV2,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
  type SyncFolderV2,
  type SyncPageV2,
  type TreeDeltaItemV2,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';

export const REVISION_CHAIN_CHECKPOINT_VERSION = 'revision-chain-checkpoint@1';
const REVISION_CHAIN_ENTRY_VERSION = 'revision-chain-entry@1';
const REVISION_TREE_DELTA_EVIDENCE_VERSION = 'revision-tree-delta-evidence@1';
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const EMPTY_REVISION_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface RevisionV2MarkerEvidence {
  schemaVersion: string | null | undefined;
  recipeVersion: string | null | undefined;
  sidecar: unknown;
  folderRowCount: number;
  hasPlacedPage: boolean;
  treeDeltaRowCount: number;
  migrationBatchId: string | null | undefined;
  parentShouldBeV2?: boolean;
}

export interface RevisionChainNode {
  id: string;
  spaceId: string;
  sequence: number;
  parentRevisionId: string | null;
  revisionContentHash?: string | null;
}

export interface RevisionChainHashNode extends RevisionChainNode {
  revisionContentHash: string;
  schemaVersion: string;
  recipeVersion: string;
}

export interface RevisionChainCheckpointEvidence {
  contractVersion: string;
  spaceId: string;
  boundarySequence: number;
  boundaryRevisionId: string;
  boundaryParentRevisionId: string | null;
  boundaryRevisionContentHash: string;
  rollingChainHash: string;
  anchorSequence: number;
  anchorRevisionId: string;
  anchorParentRevisionId: string;
  anchorRevisionContentHash: string;
  anchorTreeDeltaHash: string;
  evidenceHash: string;
}

type UnsealedRevisionChainCheckpoint = Omit<
  RevisionChainCheckpointEvidence,
  'contractVersion' | 'evidenceHash'
>;

export interface RevisionChainTrustBoundary {
  checkpoint?: RevisionChainCheckpointEvidence | null;
  trustedGenesis?: RevisionChainNode | null;
}

export interface RevisionV2ScalarMetadata extends RevisionChainHashNode {
  revisionContentHash: string;
  pageCount: bigint;
  revisionManifestByteLength: bigint;
  revisionBodyBytes: bigint;
  migrationBatchId: string | null;
  origin: string | null;
}

/** Prevent immutable readers/writers from hydrating legacy snapshot/delta JSON. */
export const REVISION_V2_SCALAR_SELECT = {
  id: true,
  spaceId: true,
  sequence: true,
  parentRevisionId: true,
  schemaVersion: true,
  recipeVersion: true,
  revisionContentHash: true,
  pageCount: true,
  revisionManifestByteLength: true,
  revisionBodyBytes: true,
  migrationBatchId: true,
  origin: true,
  createdAt: true,
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256Canonical(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function hasValidChainIdentity(node: RevisionChainNode): boolean {
  return typeof node.id === 'string'
    && node.id.length > 0
    && typeof node.spaceId === 'string'
    && node.spaceId.length > 0
    && Number.isSafeInteger(node.sequence)
    && node.sequence > 0
    && (node.sequence === 1
      ? node.parentRevisionId === null
      : typeof node.parentRevisionId === 'string'
        && node.parentRevisionId.length > 0
        && node.parentRevisionId !== node.id);
}

export function advanceRevisionChainHash(
  previousRollingChainHash: string | null,
  node: RevisionChainHashNode,
): string {
  if (
    (previousRollingChainHash !== null && !SHA256_HEX.test(previousRollingChainHash))
    || !hasValidChainIdentity(node)
    || !SHA256_HEX.test(node.revisionContentHash)
    || typeof node.schemaVersion !== 'string'
    || node.schemaVersion.length === 0
    || typeof node.recipeVersion !== 'string'
    || node.recipeVersion.length === 0
  ) throw new Error('Invalid revision chain hash entry');
  return sha256Canonical({
    contractVersion: REVISION_CHAIN_ENTRY_VERSION,
    previousRollingChainHash,
    spaceId: node.spaceId,
    sequence: node.sequence,
    revisionId: node.id,
    parentRevisionId: node.parentRevisionId,
    revisionContentHash: node.revisionContentHash,
    schemaVersion: node.schemaVersion,
    recipeVersion: node.recipeVersion,
  });
}

function revisionChainCheckpointEvidenceHash(
  checkpoint: UnsealedRevisionChainCheckpoint & { contractVersion: string },
): string {
  return sha256Canonical({
    contractVersion: checkpoint.contractVersion,
    spaceId: checkpoint.spaceId,
    boundarySequence: checkpoint.boundarySequence,
    boundaryRevisionId: checkpoint.boundaryRevisionId,
    boundaryParentRevisionId: checkpoint.boundaryParentRevisionId,
    boundaryRevisionContentHash: checkpoint.boundaryRevisionContentHash,
    rollingChainHash: checkpoint.rollingChainHash,
    anchorSequence: checkpoint.anchorSequence,
    anchorRevisionId: checkpoint.anchorRevisionId,
    anchorParentRevisionId: checkpoint.anchorParentRevisionId,
    anchorRevisionContentHash: checkpoint.anchorRevisionContentHash,
    anchorTreeDeltaHash: checkpoint.anchorTreeDeltaHash,
  });
}

export function sealRevisionChainCheckpoint(
  fields: UnsealedRevisionChainCheckpoint,
): RevisionChainCheckpointEvidence {
  const checkpoint = {
    contractVersion: REVISION_CHAIN_CHECKPOINT_VERSION,
    ...fields,
  };
  return {
    ...checkpoint,
    evidenceHash: revisionChainCheckpointEvidenceHash(checkpoint),
  };
}

export function isValidRevisionChainCheckpoint(
  checkpoint: RevisionChainCheckpointEvidence,
  expectedSpaceId: string,
): boolean {
  if (
    !checkpoint
    || checkpoint.contractVersion !== REVISION_CHAIN_CHECKPOINT_VERSION
    || checkpoint.spaceId !== expectedSpaceId
    || !Number.isSafeInteger(checkpoint.boundarySequence)
    || checkpoint.boundarySequence < 1
    || typeof checkpoint.boundaryRevisionId !== 'string'
    || checkpoint.boundaryRevisionId.length === 0
    || (checkpoint.boundarySequence === 1
      ? checkpoint.boundaryParentRevisionId !== null
      : typeof checkpoint.boundaryParentRevisionId !== 'string'
        || checkpoint.boundaryParentRevisionId.length === 0)
    || checkpoint.boundaryRevisionId === checkpoint.boundaryParentRevisionId
    || !SHA256_HEX.test(checkpoint.boundaryRevisionContentHash)
    || !SHA256_HEX.test(checkpoint.rollingChainHash)
    || !Number.isSafeInteger(checkpoint.anchorSequence)
    || checkpoint.anchorSequence !== checkpoint.boundarySequence + 1
    || typeof checkpoint.anchorRevisionId !== 'string'
    || checkpoint.anchorRevisionId.length === 0
    || checkpoint.anchorRevisionId === checkpoint.boundaryRevisionId
    || typeof checkpoint.anchorParentRevisionId !== 'string'
    || checkpoint.anchorParentRevisionId !== checkpoint.boundaryRevisionId
    || !SHA256_HEX.test(checkpoint.anchorRevisionContentHash)
    || !SHA256_HEX.test(checkpoint.anchorTreeDeltaHash)
    || !SHA256_HEX.test(checkpoint.evidenceHash)
  ) return false;
  return revisionChainCheckpointEvidenceHash(checkpoint) === checkpoint.evidenceHash;
}

export function hasTrustedV2GenesisMarker(
  spaceId: string,
  revision: RevisionChainNode & {
    schemaVersion: string;
    recipeVersion: string;
    origin: string | null;
    migrationBatchId: string | null;
  },
  sidecar: unknown,
): boolean {
  const migration = record(record(sidecar)?.spaceFolderMigration);
  const v2Revision = record(migration?.v2Revision);
  const batchKey = `space-folders-v1:${spaceId}`;
  return hasValidChainIdentity(revision)
    && revision.spaceId === spaceId
    && revision.schemaVersion === 'content-tree@2'
    && revision.recipeVersion === 'space-folders-v1'
    && revision.origin === 'migration'
    && revision.migrationBatchId === batchKey
    && migration?.version === 1
    && migration.status === 'completed'
    && migration.batchKey === batchKey
    && typeof migration.inputHash === 'string'
    && SHA256_HEX.test(migration.inputHash)
    && v2Revision?.protocolVersion === '2'
    && v2Revision.manifestSchema === 'TreeRevisionContentManifestV2';
}

export function hasTrustedV2GenesisInputMarker(
  spaceId: string,
  revision: RevisionChainNode & {
    origin: string | null;
    migrationBatchId: string | null;
  },
  sidecar: unknown,
): boolean {
  const migration = record(record(sidecar)?.spaceFolderMigration);
  const batchKey = `space-folders-v1:${spaceId}`;
  return hasValidChainIdentity(revision)
    && revision.spaceId === spaceId
    && revision.origin === 'migration'
    && revision.migrationBatchId === batchKey
    && migration?.version === 1
    && migration.status === 'completed'
    && migration.batchKey === batchKey
    && typeof migration.inputHash === 'string'
    && SHA256_HEX.test(migration.inputHash);
}

export function hasRevisionV2SidecarMarker(sidecar: unknown): boolean {
  const migration = record(record(sidecar)?.spaceFolderMigration);
  return !!migration && Object.prototype.hasOwnProperty.call(migration, 'v2Revision');
}

/**
 * Every persisted signal that identifies a Folder-aware revision belongs here.
 * Reader and writer must use this predicate so a partial marker cannot silently
 * downgrade either the current revision or its exact predecessor to legacy.
 */
export function revisionShouldBeV2(evidence: RevisionV2MarkerEvidence): boolean {
  return evidence.schemaVersion === 'content-tree@2'
    || evidence.recipeVersion === 'space-folders-v1'
    || hasRevisionV2SidecarMarker(evidence.sidecar)
    || evidence.folderRowCount > 0
    || evidence.hasPlacedPage
    || evidence.treeDeltaRowCount > 0
    || (typeof evidence.migrationBatchId === 'string'
      && evidence.migrationBatchId.startsWith('space-folders-v1:'))
    || evidence.parentShouldBeV2 === true;
}

function revisionV2IntegrityFailure(): never {
  throw new Error('REVISION_V2_INTEGRITY_FAILED');
}

function folderDepthV2(
  folder: SyncFolderV2,
  folders: ReadonlyMap<string, SyncFolderV2>,
): number {
  let depth = 0;
  let current = folder;
  const seen = new Set<string>();
  while (current.parentFolderId !== null) {
    if (seen.has(current.folderId)) revisionV2IntegrityFailure();
    seen.add(current.folderId);
    const parent = folders.get(current.parentFolderId);
    if (!parent) revisionV2IntegrityFailure();
    current = parent;
    depth += 1;
  }
  return depth;
}

export async function loadRevisionV2Evidence(
  tx: Prisma.TransactionClient,
  spaceId: string,
  revisionId: string,
) {
  const [folderRows, pageRows, sidecarRow, deltaRows] = await Promise.all([
    tx.syncRevisionFolderRow.findMany({ where: { revisionId } }),
    tx.syncRevisionPageRow.findMany({ where: { revisionId }, include: { content: true } }),
    tx.legacyRevisionSidecar.findUnique({ where: { revisionId } }),
    tx.syncRevisionTreeDeltaRow.findMany({ where: { revisionId }, orderBy: { ordinal: 'asc' } }),
  ]);
  for (const folder of folderRows) {
    const portable = validatePortableDirectoryPath(folder.path);
    if (portable.path !== folder.path || portable.key !== folder.pathKey) revisionV2IntegrityFailure();
  }
  for (const page of pageRows) {
    const portable = validatePortableMarkdownPath(page.path);
    const body = normalizeMarkdown(page.content.body);
    if (
      portable.path !== page.path
      || portable.key !== page.pathKey
      || body !== page.content.body
      || await contentHash(body) !== page.contentHash
      || Buffer.byteLength(body, 'utf8') !== page.content.byteLength
    ) revisionV2IntegrityFailure();
  }
  const manifest = canonicalTreeRevisionManifestV2({
    protocolVersion: '2',
    spaceId,
    folders: folderRows.map((folder): SyncFolderV2 => ({
      folderId: folder.folderId,
      parentFolderId: folder.parentFolderId,
      name: folder.name,
      path: folder.path,
      sortOrder: folder.sortOrder,
      updatedAt: folder.updatedAt.toISOString(),
    })),
    pages: pageRows.map((page): SyncPageV2 => ({
      pageId: page.pageId,
      folderId: page.folderId,
      path: page.path,
      title: page.title,
      body: page.content.body,
      contentHash: page.contentHash,
      updatedAt: page.updatedAt.toISOString(),
    })),
  });
  const folderById = new Map(manifest.folders.map((folder) => [folder.folderId, folder]));
  for (const folder of manifest.folders) folderDepthV2(folder, folderById);
  if (manifest.pages.some((page) => page.folderId !== null && !folderById.has(page.folderId))) {
    revisionV2IntegrityFailure();
  }
  const empty = manifest.folders.length === 0 && manifest.pages.length === 0;
  return {
    manifest,
    calculatedHash: empty ? EMPTY_REVISION_HASH : await treeRevisionContentHashV2(manifest),
    manifestBytes: empty ? 0 : canonicalBytes(manifest).byteLength,
    bodyBytes: manifest.pages.reduce(
      (total, page) => total + Buffer.byteLength(page.body, 'utf8'),
      0,
    ),
    folderRowCount: folderRows.length,
    hasPlacedPage: pageRows.some((page) => page.folderId !== null),
    sidecar: sidecarRow?.sidecar,
    deltaRows,
  };
}

export type LoadedRevisionV2Evidence = Awaited<ReturnType<typeof loadRevisionV2Evidence>>;

export type RevisionV2IntegrityEvidence = Omit<
  LoadedRevisionV2Evidence,
  'sidecar' | 'deltaRows'
> & {
  sidecar: unknown;
  deltaRows: readonly StoredRevisionTreeDeltaRow[];
};

export function revisionEvidenceShouldBeV2(
  revision: Pick<RevisionV2ScalarMetadata, 'schemaVersion' | 'recipeVersion' | 'migrationBatchId'>,
  evidence: LoadedRevisionV2Evidence,
  parentShouldBeV2 = false,
): boolean {
  return revisionShouldBeV2({
    schemaVersion: revision.schemaVersion,
    recipeVersion: revision.recipeVersion,
    sidecar: evidence.sidecar,
    folderRowCount: evidence.folderRowCount,
    hasPlacedPage: evidence.hasPlacedPage,
    treeDeltaRowCount: evidence.deltaRows.length,
    migrationBatchId: revision.migrationBatchId,
    parentShouldBeV2,
  });
}

/**
 * Detect any retained v2 marker before a proposed Task 6 genesis without
 * rebuilding legacy snapshots or issuing one immutable-row query per revision.
 */
export async function hasRetainedRevisionV2Evidence(
  tx: Prisma.TransactionClient,
  revisions: readonly RevisionV2ScalarMetadata[],
): Promise<boolean> {
  if (revisions.length === 0) return false;
  if (revisions.some((revision) => revisionShouldBeV2({
    schemaVersion: revision.schemaVersion,
    recipeVersion: revision.recipeVersion,
    sidecar: null,
    folderRowCount: 0,
    hasPlacedPage: false,
    treeDeltaRowCount: 0,
    migrationBatchId: revision.migrationBatchId,
  }))) return true;

  const revisionIds = revisions.map((revision) => revision.id);
  const [sidecars, folderRow, placedPageRow, deltaRow] = await Promise.all([
    tx.legacyRevisionSidecar.findMany({
      where: { revisionId: { in: revisionIds } },
      select: { sidecar: true },
    }),
    tx.syncRevisionFolderRow.findFirst({
      where: { revisionId: { in: revisionIds } },
      select: { revisionId: true },
    }),
    tx.syncRevisionPageRow.findFirst({
      where: { revisionId: { in: revisionIds }, folderId: { not: null } },
      select: { revisionId: true },
    }),
    tx.syncRevisionTreeDeltaRow.findFirst({
      where: { revisionId: { in: revisionIds } },
      select: { revisionId: true },
    }),
  ]);
  return folderRow !== null
    || placedPageRow !== null
    || deltaRow !== null
    || sidecars.some((row) => hasRevisionV2SidecarMarker(row.sidecar));
}

function expectedStoredTreeDeltaRows(expectedItems: TreeDeltaItemV2[]) {
  return expectedItems.map((item, ordinal) => {
    if (item.operation === 'archive_page') return {
      ordinal, operation: item.operation, folderId: null, pageId: item.pageId,
      previousPath: item.previousPath, contentHash: null,
    };
    if (item.operation === 'archive_folder') return {
      ordinal, operation: item.operation, folderId: item.folderId, pageId: null,
      previousPath: item.previousPath, contentHash: null,
    };
    if (item.operation === 'upsert_folder') return {
      ordinal, operation: item.operation, folderId: item.folder.folderId, pageId: null,
      previousPath: null, contentHash: null,
    };
    return {
      ordinal, operation: item.operation, folderId: null, pageId: item.page.pageId,
      previousPath: null, contentHash: item.page.contentHash,
    };
  });
}

export function storedTreeDeltaRowsV2(expectedItems: TreeDeltaItemV2[]) {
  return expectedStoredTreeDeltaRows(expectedItems);
}

export interface StoredRevisionTreeDeltaRow {
  ordinal: number;
  operation: string;
  folderId: string | null;
  pageId: string | null;
  previousPath: string | null;
  contentHash: string | null;
}

export function revisionTreeDeltaHashV2(
  rows: readonly StoredRevisionTreeDeltaRow[],
): string {
  return sha256Canonical({
    contractVersion: REVISION_TREE_DELTA_EVIDENCE_VERSION,
    rows: rows.map((row) => ({
      ordinal: row.ordinal,
      operation: row.operation,
      folderId: row.folderId,
      pageId: row.pageId,
      previousPath: row.previousPath,
      contentHash: row.contentHash,
    })),
  });
}

export function assertStoredTreeDeltaV2(
  rows: readonly StoredRevisionTreeDeltaRow[],
  expectedItems: TreeDeltaItemV2[],
): void {
  const expectedRows = expectedStoredTreeDeltaRows(expectedItems);
  if (rows.length !== expectedRows.length) revisionV2IntegrityFailure();
  for (let index = 0; index < rows.length; index += 1) {
    const actual = rows[index]!;
    const expected = expectedRows[index]!;
    if (
      actual.ordinal !== expected.ordinal
      || actual.operation !== expected.operation
      || actual.folderId !== expected.folderId
      || actual.pageId !== expected.pageId
      || actual.previousPath !== expected.previousPath
      || actual.contentHash !== expected.contentHash
    ) revisionV2IntegrityFailure();
  }
}

export function assertCompleteRevisionV2(
  revision: Pick<
    RevisionV2ScalarMetadata,
    'schemaVersion' | 'recipeVersion' | 'revisionContentHash' | 'pageCount'
    | 'revisionManifestByteLength' | 'revisionBodyBytes'
  >,
  evidence: RevisionV2IntegrityEvidence,
  parentManifest: TreeRevisionContentManifestV2 | null,
): TreeRevisionContentManifestV2 {
  const manifest = assertRevisionV2Metadata(revision, evidence);
  assertStoredTreeDeltaV2(evidence.deltaRows, treeRevisionDeltaV2(parentManifest, manifest));
  return manifest;
}

export function assertRevisionV2Metadata(
  revision: Pick<
    RevisionV2ScalarMetadata,
    'schemaVersion' | 'recipeVersion' | 'revisionContentHash' | 'pageCount'
    | 'revisionManifestByteLength' | 'revisionBodyBytes'
  >,
  evidence: RevisionV2IntegrityEvidence,
): TreeRevisionContentManifestV2 {
  const { manifest, calculatedHash, manifestBytes, bodyBytes } = evidence;
  if (
    revision.schemaVersion !== 'content-tree@2'
    || revision.recipeVersion !== 'space-folders-v1'
    || revision.revisionContentHash !== calculatedHash
    || revision.pageCount !== BigInt(manifest.pages.length)
    || revision.revisionManifestByteLength !== BigInt(manifestBytes)
    || revision.revisionBodyBytes !== BigInt(bodyBytes)
  ) revisionV2IntegrityFailure();
  const migration = record(record(evidence.sidecar)?.spaceFolderMigration);
  const v2 = record(migration?.v2Revision);
  if (
    v2?.protocolVersion !== '2'
    || v2.manifestSchema !== 'TreeRevisionContentManifestV2'
    || v2.folderCount !== String(manifest.folders.length)
    || v2.pageCount !== String(manifest.pages.length)
    || v2.revisionContentHash !== calculatedHash
    || v2.revisionManifestByteLength !== String(manifestBytes)
    || v2.revisionBodyBytes !== String(bodyBytes)
    || v2.treeDeltaCount !== String(evidence.deltaRows.length)
  ) revisionV2IntegrityFailure();
  return manifest;
}

export interface ValidatedRevisionChainTrust {
  checkpoint: RevisionChainCheckpointEvidence | null;
  trustedGenesis: RevisionV2ScalarMetadata | null;
}

/**
 * Resolve the only two allowed retained-chain trust boundaries. A checkpoint
 * also validates its live anchor snapshot and exact immutable delta hash; a
 * legacy-prefix cutover validates the complete Task 6 genesis snapshot and
 * its canonical full-upsert delta before it becomes trusted.
 */
export async function validateRevisionChainTrust(
  tx: Prisma.TransactionClient,
  spaceId: string,
  current: RevisionV2ScalarMetadata,
  ancestors: readonly RevisionV2ScalarMetadata[],
): Promise<ValidatedRevisionChainTrust> {
  const checkpoint = await tx.spaceRevisionChainCheckpoint.findUnique({ where: { spaceId } });
  if (checkpoint) {
    if (!hasCompleteRevisionChain(current, ancestors, { checkpoint })) revisionV2IntegrityFailure();
    const anchor = current.sequence === checkpoint.anchorSequence
      ? current
      : ancestors.find((candidate) => candidate.sequence === checkpoint.anchorSequence);
    if (!anchor) revisionV2IntegrityFailure();
    const evidence = await loadRevisionV2Evidence(tx, spaceId, anchor.id);
    assertRevisionV2Metadata(anchor, evidence);
    if (revisionTreeDeltaHashV2(evidence.deltaRows) !== checkpoint.anchorTreeDeltaHash) {
      revisionV2IntegrityFailure();
    }
    return { checkpoint, trustedGenesis: null };
  }
  if (hasCompleteRevisionChain(current, ancestors)) {
    return { checkpoint: null, trustedGenesis: null };
  }
  const candidate = [current, ...ancestors]
    .filter((revision) => (
      revision.origin === 'migration'
      && revision.migrationBatchId === `space-folders-v1:${spaceId}`
      && revision.schemaVersion === 'content-tree@2'
      && revision.recipeVersion === 'space-folders-v1'
    ))
    .sort((left, right) => left.sequence - right.sequence)[0];
  if (!candidate) revisionV2IntegrityFailure();
  const retainedBeforeGenesis = [current, ...ancestors]
    .filter((revision) => revision.sequence < candidate.sequence);
  if (await hasRetainedRevisionV2Evidence(tx, retainedBeforeGenesis)) {
    revisionV2IntegrityFailure();
  }
  const evidence = await loadRevisionV2Evidence(tx, spaceId, candidate.id);
  if (
    !hasTrustedV2GenesisMarker(spaceId, candidate, evidence.sidecar)
    || !hasCompleteRevisionChain(current, ancestors, { trustedGenesis: candidate })
  ) revisionV2IntegrityFailure();
  assertCompleteRevisionV2(candidate, evidence, null);
  return { checkpoint: null, trustedGenesis: candidate };
}

/**
 * The authoritative revision writer contract is a strict singly-linked chain:
 * sequence one has no parent, and every later revision points at sequence - 1
 * in the same Space. Strict descent also makes cycles impossible without a
 * recursive walk.
 */
export function hasExactRevisionPredecessor(
  current: RevisionChainNode,
  parent: RevisionChainNode | null,
): boolean {
  if (!Number.isSafeInteger(current.sequence) || current.sequence < 1) return false;
  if (current.sequence === 1) return current.parentRevisionId === null && parent === null;
  if (!current.parentRevisionId || !parent) return false;
  return parent.id === current.parentRevisionId
    && parent.id !== current.id
    && parent.spaceId === current.spaceId
    && Number.isSafeInteger(parent.sequence)
    && parent.sequence === current.sequence - 1;
}

/** Validate an entire chain already loaded by one set-based Space query. */
export function hasCompleteRevisionChain(
  current: RevisionChainNode,
  ancestors: readonly RevisionChainNode[],
  trust: RevisionChainTrustBoundary = {},
): boolean {
  if (!hasValidChainIdentity(current)) return false;
  const checkpoint = trust.checkpoint ?? null;
  const trustedGenesis = trust.trustedGenesis ?? null;
  if (checkpoint && trustedGenesis) return false;

  if (checkpoint) {
    if (
      !isValidRevisionChainCheckpoint(checkpoint, current.spaceId)
      || current.sequence <= checkpoint.boundarySequence
      || ancestors.some((ancestor) => ancestor.sequence <= checkpoint.boundarySequence)
      || ancestors.length !== current.sequence - checkpoint.boundarySequence - 1
    ) return false;
    const bySequence = revisionChainMap(current, ancestors);
    if (!bySequence) return false;
    let child = current;
    for (let sequence = current.sequence - 1; sequence > checkpoint.boundarySequence; sequence -= 1) {
      const parent = bySequence.get(sequence) ?? null;
      if (!hasExactRevisionPredecessor(child, parent)) return false;
      child = parent!;
    }
    return hasExactRevisionPredecessor(child, {
      id: checkpoint.boundaryRevisionId,
      spaceId: checkpoint.spaceId,
      sequence: checkpoint.boundarySequence,
      parentRevisionId: checkpoint.boundaryParentRevisionId,
    })
      && child.id === checkpoint.anchorRevisionId
      && child.sequence === checkpoint.anchorSequence
      && child.parentRevisionId === checkpoint.anchorParentRevisionId
      && child.revisionContentHash === checkpoint.anchorRevisionContentHash;
  }

  if (trustedGenesis) {
    if (
      !hasValidChainIdentity(trustedGenesis)
      || trustedGenesis.spaceId !== current.spaceId
      || trustedGenesis.sequence > current.sequence
    ) return false;
    const suffix = ancestors.filter((ancestor) => ancestor.sequence >= trustedGenesis.sequence);
    if (suffix.length !== current.sequence - trustedGenesis.sequence) return false;
    const bySequence = revisionChainMap(current, suffix);
    if (!bySequence) return false;
    let child = current;
    for (let sequence = current.sequence - 1; sequence >= trustedGenesis.sequence; sequence -= 1) {
      const parent = bySequence.get(sequence) ?? null;
      if (!hasExactRevisionPredecessor(child, parent)) return false;
      child = parent!;
    }
    return child.id === trustedGenesis.id
      && child.spaceId === trustedGenesis.spaceId
      && child.sequence === trustedGenesis.sequence
      && child.parentRevisionId === trustedGenesis.parentRevisionId;
  }

  if (ancestors.length !== current.sequence - 1) return false;
  const bySequence = revisionChainMap(current, ancestors);
  if (!bySequence) return false;
  let child = current;
  for (let sequence = current.sequence - 1; sequence >= 1; sequence -= 1) {
    const parent = bySequence.get(sequence) ?? null;
    if (!hasExactRevisionPredecessor(child, parent)) return false;
    child = parent!;
  }
  return hasExactRevisionPredecessor(child, null);
}

function revisionChainMap(
  current: RevisionChainNode,
  ancestors: readonly RevisionChainNode[],
): Map<number, RevisionChainNode> | null {
  const bySequence = new Map<number, RevisionChainNode>();
  for (const ancestor of ancestors) {
    if (
      ancestor.spaceId !== current.spaceId
      || !hasValidChainIdentity(ancestor)
      || ancestor.sequence >= current.sequence
      || bySequence.has(ancestor.sequence)
    ) return null;
    bySequence.set(ancestor.sequence, ancestor);
  }
  return bySequence;
}
