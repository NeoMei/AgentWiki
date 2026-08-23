import { BusinessException } from '../core/filters/business-error';
import { HistoryCursorService } from './history-cursor.service';

describe('HistoryCursorService', () => {
  const config = { get: jest.fn().mockReturnValue('history-cursor-test-pepper') } as any;
  const cursors = new HistoryCursorService(config);

  it('round-trips an opaque kind- and Run-bound keyset cursor', () => {
    const cursor = cursors.encode({
      kind: 'events', runId: 'run-1', position: { sequence: 10_100 },
    });
    expect(cursor).not.toContain('10100');
    expect(cursors.decode(cursor, 'events', 'run-1')).toEqual({ sequence: 10_100 });
    expect(() => cursors.decode(cursor, 'todos', 'run-1')).toThrow(BusinessException);
    expect(() => cursors.decode(cursor, 'events', 'run-2')).toThrow(BusinessException);
  });

  it('rejects a forged or malformed cursor', () => {
    const cursor = cursors.encode({
      kind: 'artifacts', runId: 'run-1', position: { at: '2026-08-24T00:00:00.000Z', id: 'artifact-1' },
    });
    expect(() => cursors.decode(`${cursor.slice(0, -1)}x`, 'artifacts', 'run-1')).toThrow(BusinessException);
    expect(() => cursors.decode('not-a-cursor', 'artifacts', 'run-1')).toThrow(BusinessException);
  });

  it('rejects a correctly signed cursor whose DTO has unknown fields', () => {
    const body = Buffer.from(JSON.stringify({
      v: 1, kind: 'events', runId: 'run-1', position: { sequence: 10 }, extra: true,
    }), 'utf8').toString('base64url');
    const signature = (cursors as any).sign(body);

    expect(() => cursors.decode(`${body}.${signature}`, 'events', 'run-1')).toThrow(BusinessException);
  });

  it('binds Run-list cursors to the Space and exact status filter', () => {
    const cursor = (cursors as any).encodeRunList({
      spaceId: 'space-1', status: 'active', position: { at: '2026-08-24T00:00:00.000Z', id: 'run-100' },
    });

    expect((cursors as any).decodeRunList(cursor, 'space-1', 'active')).toEqual({
      at: '2026-08-24T00:00:00.000Z', id: 'run-100',
    });
    expect(() => (cursors as any).decodeRunList(cursor, 'space-2', 'active')).toThrow(BusinessException);
    expect(() => (cursors as any).decodeRunList(cursor, 'space-1', 'history')).toThrow(BusinessException);
  });
});
