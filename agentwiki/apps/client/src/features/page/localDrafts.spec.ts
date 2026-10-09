import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canRestoreDraft, clearDraftIfExact, compareDraft, draftStorageKey, loadDraft, readDraft, saveDraft } from './localDrafts';

const scope = { userId: 'alice', spaceId: 'wiki', pageId: 'page' };
const remote = { ...scope, updatedAt: '2026-10-06T01:00:00.000Z', title: '标题', content: '# 正文\n', canEdit: true };
const input = { baseUpdatedAt: remote.updatedAt, title: '草稿', content: '# 正文\n人工修改' };
const record = { schemaVersion: 1 as const, ...scope, ...input, savedAt: 1234 };
beforeEach(() => localStorage.clear());

describe('recoverable local draft storage', () => {
  it('loads exact Unicode/source bytes after a new read, without modifying the remote snapshot', () => {
    expect(saveDraft(scope, input, remote, 1234)).toEqual({ status: 'saved', draft: record });
    expect(loadDraft(scope)).toEqual(record);
    expect(remote.content).toBe('# 正文\n');
  });

  it('isolates user, Space and page and validates identity inside the stored record', () => {
    saveDraft(scope, input, remote, 1234);
    for (const foreign of [{ ...scope, userId: 'bob' }, { ...scope, spaceId: 'other' }, { ...scope, pageId: 'other' }]) {
      expect(loadDraft(foreign)).toBeNull();
      localStorage.setItem(draftStorageKey(foreign), JSON.stringify(record));
      expect(readDraft(foreign).status).toBe('invalid');
    }
  });

  it('does not let delimiter-shaped identities collide', () => {
    const first = { userId: 'a:b', spaceId: 'c', pageId: 'd' };
    const second = { userId: 'a', spaceId: 'b:c', pageId: 'd' };
    saveDraft(first, input, { ...remote, ...first }, 1234);
    expect(loadDraft(second)).toBeNull();
  });

  it.each([
    ['malformed JSON', '{'],
    ['unknown schema', JSON.stringify({ ...record, schemaVersion: 2 })],
    ['invalid timestamp', JSON.stringify({ ...record, savedAt: -1 })],
    ['wrong content type', JSON.stringify({ ...record, content: 42 })],
    ['missing baseline', JSON.stringify({ ...record, baseUpdatedAt: '' })],
  ])('rejects %s without offering a partial restore', (_, raw) => {
    localStorage.setItem(draftStorageKey(scope), raw);
    expect(readDraft(scope)).toEqual({ status: 'invalid' });
    expect(loadDraft(scope)).toBeNull();
  });

  it('rejects invalid scope before reading or writing storage', () => {
    const invalid = { ...scope, userId: '' };
    expect(readDraft(invalid)).toEqual({ status: 'invalid' });
    expect(saveDraft(invalid, input, remote, 1234)).toEqual({ status: 'invalid' });
    expect(localStorage.length).toBe(0);
  });

  it('keeps unchanged server title/content out of storage even if the editor dirty flag stayed true after undo', () => {
    expect(saveDraft(scope, { baseUpdatedAt: remote.updatedAt, title: remote.title, content: remote.content }, remote, 1234)).toEqual({ status: 'unchanged' });
    expect(loadDraft(scope)).toBeNull();
  });

  it('persists a title-only human edit', () => {
    expect(saveDraft(scope, { ...input, content: remote.content }, remote, 1234).status).toBe('saved');
    expect(loadDraft(scope)?.title).toBe('草稿');
  });

  it('refuses snapshots from another page, stale baseline or read-only authorization', () => {
    expect(saveDraft(scope, input, { ...remote, pageId: 'other' }, 1234)).toEqual({ status: 'invalid' });
    expect(saveDraft(scope, { ...input, baseUpdatedAt: 'old' }, remote, 1234)).toEqual({ status: 'stale' });
    expect(saveDraft(scope, input, { ...remote, canEdit: false }, 1234)).toEqual({ status: 'unauthorized' });
    expect(localStorage.length).toBe(0);
  });

  it('reports blocked storage and quota errors without claiming the new draft was saved', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(readDraft(scope)).toEqual({ status: 'unavailable' });
    vi.restoreAllMocks();
    saveDraft(scope, input, remote, 1234);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveDraft(scope, { ...input, content: 'new typing' }, remote, 1235)).toEqual({ status: 'quota-exceeded' });
    expect(loadDraft(scope)?.content).toBe('# 正文\n人工修改');
  });

  it('degrades explicitly when storage is missing or a write is blocked', () => {
    expect(saveDraft(scope, input, remote, 1234, null)).toEqual({ status: 'unavailable' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(saveDraft(scope, input, remote, 1234)).toEqual({ status: 'unavailable' });
  });
});

describe('authorized restoration and exact save completion', () => {
  it('offers restoration only for a changed draft at the authorized remote version', () => {
    expect(compareDraft(record, remote)).toBe('restorable');
    expect(canRestoreDraft(record, remote)).toBe(true);
    expect(compareDraft({ ...record, title: remote.title, content: remote.content }, remote)).toBe('unchanged');
  });

  it('keeps a stale draft available for preview but blocks direct restore even if its text equals remote', () => {
    const newer = { ...remote, updatedAt: '2026-10-06T02:00:00.000Z' };
    expect(compareDraft(record, newer)).toBe('stale');
    expect(canRestoreDraft(record, newer)).toBe(false);
    expect(compareDraft({ ...record, title: newer.title, content: newer.content }, newer)).toBe('stale');
  });

  it('blocks restore on lost permission or a different account, Space or page', () => {
    expect(compareDraft(record, { ...remote, canEdit: false })).toBe('unauthorized');
    for (const foreign of [{ ...remote, userId: 'bob' }, { ...remote, spaceId: 'other' }, { ...remote, pageId: 'other' }]) {
      expect(compareDraft(record, foreign)).toBe('scope-mismatch');
      expect(canRestoreDraft(record, foreign)).toBe(false);
    }
  });

  it('removes only the exact submitted record after server Save succeeds', () => {
    saveDraft(scope, input, remote, 1234);
    expect(clearDraftIfExact(scope, record)).toEqual({ status: 'cleared' });
    expect(loadDraft(scope)).toBeNull();
    expect(clearDraftIfExact(scope, record)).toEqual({ status: 'absent' });
  });

  it('preserves newer typing and a later record with identical bytes when an older save completes', () => {
    saveDraft(scope, { ...input, content: 'new typing' }, remote, 1235);
    expect(clearDraftIfExact(scope, record)).toEqual({ status: 'different' });
    expect(loadDraft(scope)?.content).toBe('new typing');
    saveDraft(scope, input, remote, 1236);
    expect(clearDraftIfExact(scope, record)).toEqual({ status: 'different' });
    expect(loadDraft(scope)?.savedAt).toBe(1236);
  });

  it('distinguishes successive identical records even if the clock has not advanced', () => {
    saveDraft(scope, input, remote, 1234);
    const newer = saveDraft(scope, input, remote, 1234);
    expect(newer).toEqual({ status: 'saved', draft: { ...record, savedAt: 1235 } });
    expect(clearDraftIfExact(scope, record)).toEqual({ status: 'different' });
  });

  it('rejects invalid in-memory recovery records and non-boolean authorization', () => {
    expect(canRestoreDraft({ ...record, schemaVersion: 2 } as unknown as typeof record, remote)).toBe(false);
    expect(canRestoreDraft({ ...record, savedAt: NaN }, remote)).toBe(false);
    expect(canRestoreDraft(record, { ...remote, canEdit: 'yes' as unknown as boolean })).toBe(false);
  });

  it('never overwrites a recovery offer when a mount or preview returns unchanged server bytes', () => {
    saveDraft(scope, input, remote, 1234);
    expect(saveDraft(scope, { baseUpdatedAt: remote.updatedAt, title: remote.title, content: remote.content }, remote, 1235).status).toBe('unchanged');
    expect(loadDraft(scope)).toEqual(record);
  });

  it('does not remove another user record even if passed as the submitted version', () => {
    saveDraft(scope, input, remote, 1234);
    expect(clearDraftIfExact(scope, { ...record, userId: 'bob' })).toEqual({ status: 'invalid' });
    expect(loadDraft(scope)).toEqual(record);
  });

  it('reports clear failures honestly and retains the recoverable record', () => {
    saveDraft(scope, input, remote, 1234);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(clearDraftIfExact(scope, record)).toEqual({ status: 'unavailable' });
    expect(loadDraft(scope)).toEqual(record);
  });
});
