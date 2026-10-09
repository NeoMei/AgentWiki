export interface DraftScope {
  userId: string;
  spaceId: string;
  pageId: string;
}
export interface DraftInput {
  baseUpdatedAt: string;
  title: string;
  content: string;
}
export interface LocalDraft extends DraftScope, DraftInput {
  schemaVersion: 1;
  savedAt: number;
}
/** Only construct this from a successfully loaded, authorized page. */
export interface AuthorizedDraftPage extends DraftScope {
  updatedAt: string;
  title: string;
  content: string;
  canEdit: boolean;
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type DraftReadResult = { status: 'found'; draft: LocalDraft } | { status: 'absent' | 'invalid' | 'unavailable' };
export type DraftSaveResult = { status: 'saved'; draft: LocalDraft } | { status: 'unchanged' | 'invalid' | 'stale' | 'unauthorized' | 'quota-exceeded' | 'unavailable' };
export type DraftClearResult = { status: 'cleared' | 'absent' | 'different' | 'invalid' | 'unavailable' };
export type DraftComparison = 'restorable' | 'stale' | 'unchanged' | 'unauthorized' | 'scope-mismatch' | 'invalid';

const validIdentity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validScope = (scope: DraftScope): boolean => validIdentity(scope.userId) && validIdentity(scope.spaceId) && validIdentity(scope.pageId);
const sameScope = (left: DraftScope, right: DraftScope): boolean => left.userId === right.userId && left.spaceId === right.spaceId && left.pageId === right.pageId;
const validInput = (input: DraftInput): boolean => validIdentity(input.baseUpdatedAt) && typeof input.title === 'string' && typeof input.content === 'string';
const validTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validRecord = (value: unknown, scope: DraftScope): value is LocalDraft => {
  if (!value || typeof value !== 'object') return false;
  const draft = value as LocalDraft;
  return draft.schemaVersion === 1 && validScope(draft) && sameScope(draft, scope) && validInput(draft) && validTimestamp(draft.savedAt);
};
const browserStorage = (): DraftStorage | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};
const storageErrorStatus = (error: unknown): 'quota-exceeded' | 'unavailable' => {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : null;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ? 'quota-exceeded' : 'unavailable';
};

export const draftStorageKey = (scope: DraftScope): string => `agentwiki.page-draft.v1:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.spaceId)}:${encodeURIComponent(scope.pageId)}`;

/** Reading never rewrites or clears storage; mounting must not erase a recovery offer. */
export const readDraft = (scope: DraftScope, storage: DraftStorage | null = browserStorage()): DraftReadResult => {
  if (!validScope(scope)) return { status: 'invalid' };
  if (!storage) return { status: 'unavailable' };
  let raw: string | null;
  try { raw = storage.getItem(draftStorageKey(scope)); } catch { return { status: 'unavailable' }; }
  if (raw === null) return { status: 'absent' };
  try {
    const value: unknown = JSON.parse(raw);
    return validRecord(value, scope) ? { status: 'found', draft: value } : { status: 'invalid' };
  } catch { return { status: 'invalid' }; }
};

/** Convenience loader; UI uses readDraft when it needs an honest failure status. */
export const loadDraft = (scope: DraftScope, storage: DraftStorage | null = browserStorage()): LocalDraft | null => {
  const result = readDraft(scope, storage);
  return result.status === 'found' ? result.draft : null;
};

/** Call only for human edits or explicitly accepted candidates, never streams/remote snapshots. */
export const saveDraft = (
  scope: DraftScope,
  input: DraftInput,
  remote: AuthorizedDraftPage,
  savedAt = Date.now(),
  storage: DraftStorage | null = browserStorage(),
): DraftSaveResult => {
  if (!validScope(scope) || !sameScope(scope, remote) || !validInput(input) || !validTimestamp(savedAt)) return { status: 'invalid' };
  if (remote.canEdit !== true) return { status: 'unauthorized' };
  if (input.baseUpdatedAt !== remote.updatedAt) return { status: 'stale' };
  if (input.title === remote.title && input.content === remote.content) return { status: 'unchanged' };
  if (!storage) return { status: 'unavailable' };
  const previous = readDraft(scope, storage);
  if (previous.status === 'unavailable') return { status: 'unavailable' };
  // Distinguish successive versions even with identical source and same-clock saves.
  const versionTime = previous.status === 'found' ? Math.max(savedAt, previous.draft.savedAt + 1) : savedAt;
  if (!validTimestamp(versionTime)) return { status: 'invalid' };
  const draft: LocalDraft = {
    schemaVersion: 1,
    userId: scope.userId,
    spaceId: scope.spaceId,
    pageId: scope.pageId,
    baseUpdatedAt: input.baseUpdatedAt,
    title: input.title,
    content: input.content,
    savedAt: versionTime,
  };
  try {
    storage.setItem(draftStorageKey(scope), JSON.stringify(draft));
    return { status: 'saved', draft };
  } catch (error) { return { status: storageErrorStatus(error) }; }
};

export const compareDraft = (draft: LocalDraft, remote: AuthorizedDraftPage): DraftComparison => {
  if (!validScope(remote) || !sameScope(draft, remote)) return 'scope-mismatch';
  if (!validRecord(draft, remote)) return 'invalid';
  if (remote.canEdit !== true) return 'unauthorized';
  if (draft.baseUpdatedAt !== remote.updatedAt) return 'stale';
  return draft.title === remote.title && draft.content === remote.content ? 'unchanged' : 'restorable';
};
export const canRestoreDraft = (draft: LocalDraft, remote: AuthorizedDraftPage): boolean => compareDraft(draft, remote) === 'restorable';

const exactVersion = (left: LocalDraft, right: LocalDraft): boolean => sameScope(left, right)
  && left.schemaVersion === right.schemaVersion && left.baseUpdatedAt === right.baseUpdatedAt
  && left.title === right.title && left.content === right.content && left.savedAt === right.savedAt;

/** Capture submitted record before server Save; a later completion must preserve newer edits. */
export const clearDraftIfExact = (
  scope: DraftScope,
  submitted: LocalDraft,
  storage: DraftStorage | null = browserStorage(),
): DraftClearResult => {
  if (!validScope(scope) || !validRecord(submitted, scope)) return { status: 'invalid' };
  const current = readDraft(scope, storage);
  if (current.status !== 'found') return { status: current.status };
  if (!exactVersion(current.draft, submitted)) return { status: 'different' };
  try {
    storage!.removeItem(draftStorageKey(scope));
    return { status: 'cleared' };
  } catch { return { status: 'unavailable' }; }
};
