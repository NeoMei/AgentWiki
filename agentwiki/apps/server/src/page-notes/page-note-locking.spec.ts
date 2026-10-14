import { setupNotes, human, agent, input } from './page-note.testing';

function heldSpaceBoundary(s: ReturnType<typeof setupNotes>) {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  s.db.$executeRaw.mockImplementation(async (sql: { strings: string[]; values: unknown[] }) => {
    expect(sql.strings.join('')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(sql.values).toEqual(['space-1']);
    entered();
    await held;
    return 1;
  });
  return { waiting, release };
}

describe('page notes join the existing Page writer lock boundary', () => {
  it.each([['human', human], ['agent', agent]] as const)('%s waits for the Page writer before taking Space/Page rows', async (_kind, principal) => {
    const s = setupNotes();
    const boundary = heldSpaceBoundary(s);
    const creation = s.service.create(principal, 'space-1', 'page-1', input);
    await boundary.waiting;
    // An existing Page writer must remain free to update its Space row while
    // this note waits, rather than deadlocking against a pre-held row lock.
    expect(s.db.$queryRaw).not.toHaveBeenCalled();
    expect(s.db.pageNote.create).not.toHaveBeenCalled();
    if (principal.agentId) {
      expect(s.authorization.lockLiveAgentWriteAccessAcrossSpaceBoundary).toHaveBeenCalledWith(
        s.db, principal, 'space-1', ['pages:write'], expect.any(Function),
      );
      expect(s.authorization.assertLiveAgentWriteAccess).not.toHaveBeenCalled();
    }
    boundary.release();
    await expect(creation).resolves.toMatchObject({ body: input.body });
    expect(s.db.$queryRaw.mock.calls.some(([sql]: [{ strings: string[] }]) => sql.strings.join('').includes('FROM "Page"'))).toBe(true);
  });

  it.each([['human', human], ['agent', agent]] as const)('%s rechecks live access after waiting before persisting a note', async (kind, principal) => {
    const s = setupNotes();
    const boundary = heldSpaceBoundary(s);
    const creation = s.service.create(principal, 'space-1', 'page-1', input);
    await boundary.waiting;
    if (kind === 'human') s.access.member = false;
    else s.access.agent = false;
    boundary.release();
    await expect(creation).rejects.toThrow();
    expect(s.db.pageNote.create).not.toHaveBeenCalled();
    expect(s.db.$queryRaw.mock.calls.some(([sql]: [{ strings: string[] }]) => sql.strings.join('').includes('FROM "Page"'))).toBe(false);
  });
});
