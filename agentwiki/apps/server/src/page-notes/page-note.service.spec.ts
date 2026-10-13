import { setupNotes, human, agent, target, input } from './page-note.testing';

const create = (s: ReturnType<typeof setupNotes>, p = human, body: unknown = input) => s.service.create(p, 'space-1', 'page-1', body);

describe('shared page notes', () => {
  it('persists and lists all authors to another authorized user without leaking their client migration IDs', async () => {
    const s = setupNotes();
    const a = await create(s);
    await create(s, agent);
    const result = await s.service.list({ userId: 'user-2' }, 'space-1', 'page-1');
    expect(result).toMatchObject({ canCreate: true, notes: [
      { id: a.id, author: { type: 'user', id: 'user-1', name: 'Alice' }, canEdit: false },
      { author: { type: 'agent', id: 'agent-1', name: 'Codex' }, canEdit: false },
    ] });
    expect(result.notes.every(n => !('clientNoteId' in n))).toBe(true);
  });

  it('uses Agent identity independently from its human owner and preserves target context', async () => {
    const s = setupNotes();
    const note = await create(s, agent);
    expect(note).toMatchObject({ author: { type: 'agent', id: 'agent-1', name: 'Codex' }, target, canEdit: true });
    expect((await s.service.list(human, 'space-1', 'page-1')).notes[0].canEdit).toBe(false);
    await expect(s.service.update(human, 'space-1', 'page-1', note.id, { body: 'forged owner', expectedUpdatedAt: note.updatedAt })).rejects.toThrow('Only the note author');
  });

  it('retries migration idempotently without overwriting edits, while another author can reuse the same client ID', async () => {
    const s = setupNotes(); const original = await create(s);
    await s.service.update(human, 'space-1', 'page-1', original.id, { expectedUpdatedAt: original.updatedAt, body: 'Newer server text' });
    expect(await create(s)).toMatchObject({ id: original.id, body: 'Newer server text' });
    await create(s, { userId: 'user-2' });
    expect(s.rows).toHaveLength(2);
  });

  it('retains a delete tombstone so retried creation does not resurrect a note', async () => {
    const s = setupNotes(); const note = await create(s);
    expect(await s.service.remove(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt })).toEqual({ deleted: true });
    expect((await s.service.list(human, 'space-1', 'page-1')).notes).toEqual([]);
    await expect(create(s)).rejects.toThrow('deleted');
  });

  it('rejects stale update/delete versions and advances tokens even within the same millisecond', async () => {
    const s = setupNotes(); const note = await create(s);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(note.updatedAt));
    try {
      const next = await s.service.update(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt, status: 'resolved' });
      expect(Date.parse(next.updatedAt)).toBe(Date.parse(note.updatedAt) + 1);
      await expect(s.service.update(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt, body: 'stale' })).rejects.toThrow('changed');
      await expect(s.service.remove(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt })).rejects.toThrow('changed');
    } finally { dateSpy.mockRestore(); }
  });

  it('allows a genuine human viewer to annotate but leaves a nonmember platform admin read-only', async () => {
    const s = setupNotes(); await create(s);
    s.access.member = false;
    expect((await s.service.list({ userId: 'admin', platformRole: 'super_admin' }, 'space-1', 'page-1')).canCreate).toBe(false);
    await expect(create(s, { userId: 'admin', platformRole: 'super_admin' })).rejects.toThrow();
    expect(s.db.pageNote.create).toHaveBeenCalledTimes(1);
  });

  it('lets a reader Agent see every note but never create, edit, or delete', async () => {
    const s = setupNotes(); const note = await create(s, agent); s.access.role = 'reader';
    expect((await s.service.list(agent, 'space-1', 'page-1')).notes[0].canEdit).toBe(false);
    await expect(create(s, agent)).rejects.toThrow();
    await expect(s.service.update(agent, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt, body: 'bad' })).rejects.toThrow();
    await expect(s.service.remove(agent, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt })).rejects.toThrow();
  });

  it.each(['human', 'agent', 'credential', 'page'] as const)('rechecks %s revocation/deletion inside the transaction before persistence', async key => {
    const s = setupNotes();
    s.db.$transaction.mockImplementation(async (run: (db: any) => Promise<unknown>) => { s.access[key] = false; return run(s.db); });
    await expect(create(s, key === 'agent' ? agent : human)).rejects.toThrow();
    expect(s.rows).toEqual([]);
  });

  it('requires pages:read for PAT reads and pages:write for PAT annotations', async () => {
    const s = setupNotes(); const pat = { ...human, credentialId: 'pat-1' };
    s.db.apiKeyCredential.findUnique.mockResolvedValue({ scopes: ['pages:read'] });
    expect((await s.service.list(pat, 'space-1', 'page-1')).canCreate).toBe(false);
    expect(s.authorization.assertLiveHumanCredential).toHaveBeenCalledWith(s.db, pat, ['pages:read']);
    await create(s, pat);
    expect(s.authorization.assertLiveHumanCredential).toHaveBeenCalledWith(s.db, pat, ['pages:write']);
  });

  it('rejects a cross-space selector before reading or changing notes', async () => {
    const s = setupNotes();
    await expect(s.service.list(human, 'space-2', 'page-1')).rejects.toThrow('does not belong');
    await expect(s.service.create(human, 'space-2', 'page-1', input)).rejects.toThrow('does not belong');
    expect(s.db.pageNote.findMany).not.toHaveBeenCalled(); expect(s.rows).toHaveLength(0);
  });

  it('keeps old source anchors and later re-open clears the task reference', async () => {
    const s = setupNotes(); const note = await create(s, human, { ...input, status: 'dispatched', taskId: 'task-1' });
    expect(note.target).toEqual(target);
    const next = await s.service.update(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt, status: 'pending' });
    expect(next.status).toBe('pending'); expect(next).not.toHaveProperty('taskId');
  });

  it.each([
    { ...input, author: { type: 'user', id: 'victim' } }, { ...input, userId: 'victim' }, { ...input, body: ' ' },
    { ...input, body: 'x'.repeat(10001) }, { ...input, target: { ...target, to: 9 } },
    { ...input, target: { ...target, prefix: 'too long for offset' } },
    { ...input, target: { ...target, baseUpdatedAt: 'invalid' } }, { ...input, target: { ...target, kind: 'document' } },
    { ...input, target: { ...target, from: -1 } }, { ...input, clientNoteId: '' },
  ])('rejects malformed or forged input before any persistence: %j', async body => {
    const s = setupNotes(); await expect(create(s, human, body)).rejects.toThrow('Invalid page note'); expect(s.rows).toEqual([]);
  });

  it('rejects forged author fields and empty patch on update', async () => {
    const s = setupNotes(); const note = await create(s);
    await expect(s.service.update(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt, authorId: 'other' })).rejects.toThrow('Invalid page note');
    await expect(s.service.update(human, 'space-1', 'page-1', note.id, { expectedUpdatedAt: note.updatedAt })).rejects.toThrow('Invalid page note');
  });
});
