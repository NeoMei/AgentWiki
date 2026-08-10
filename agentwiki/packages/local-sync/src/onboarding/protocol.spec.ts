import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ProtocolEncoder,
  assertValidEvent,
  parseReply,
  ProtocolParseError,
  type ProtocolSink,
  isConfirmationReply,
} from './protocol.js';

function capturingSink(): ProtocolSink & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

describe('NDJSON protocol encoder', () => {
  it('emits exactly one JSON object per line', () => {
    const sink = capturingSink();
    const encoder = new ProtocolEncoder('sess-1', sink);
    encoder.emit({ type: 'heartbeat', step: 'polling' });
    encoder.emit({ type: 'heartbeat', step: 'polling' });
    expect(sink.lines).toHaveLength(2);
    for (const line of sink.lines) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.split('\n')).toHaveLength(2); // content + trailing empty
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('uses strictly monotonic sequence numbers', () => {
    const sink = capturingSink();
    const encoder = new ProtocolEncoder('sess-1', sink);
    encoder.emit({ type: 'progress', step: 'a', status: 'running' });
    encoder.emit({ type: 'progress', step: 'b', status: 'done' });
    encoder.emit({ type: 'progress', step: 'c', status: 'running' });
    const seqs = sink.lines.map((line) => JSON.parse(line).seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('stamps every event with protocol version, session id, and timestamp', () => {
    const sink = capturingSink();
    const encoder = new ProtocolEncoder('sess-42', sink);
    const event = encoder.emit({ type: 'heartbeat', step: 'idle' });
    expect(event.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(event.sessionId).toBe('sess-42');
    expect(event.seq).toBe(1);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The emitted object round-trips through the schema validator.
    expect(() => assertValidEvent(JSON.parse(sink.lines[0]))).not.toThrow();
  });

  it('correlates input and confirmation events by requestId', () => {
    const sink = capturingSink();
    const encoder = new ProtocolEncoder('sess-1', sink);
    const input = encoder.emit({
      type: 'input_required',
      requestId: 'r1',
      fields: [{ name: 'agentName', label: 'Agent', type: 'string' as const, required: true }],
    });
    expect((input as { requestId: string }).requestId).toBe('r1');
    const confirm = encoder.emit({
      type: 'confirmation_required',
      requestId: 'r2',
      planHash: 'abc123',
    });
    expect((confirm as { requestId: string }).requestId).toBe('r2');
  });
});

describe('NDJSON protocol reply parsing', () => {
  it('parses an input reply with arbitrary values', () => {
    const reply = parseReply(JSON.stringify({ requestId: 'r1', values: { agentName: 'Codex' } }));
    expect(reply.requestId).toBe('r1');
    expect(isConfirmationReply(reply)).toBe(false);
  });

  it('parses a confirmation reply', () => {
    const reply = parseReply(
      JSON.stringify({ requestId: 'r2', confirmed: true, planHash: 'abc123' }),
    );
    if (!isConfirmationReply(reply)) throw new Error('expected confirmation reply');
    expect(reply.confirmed).toBe(true);
  });

  it('rejects unknown fields strictly', () => {
    expect(() =>
      parseReply(JSON.stringify({ requestId: 'r1', values: {}, sneaky: true })),
    ).toThrow();
  });

  it('rejects malformed JSON', () => {
    expect(() => parseReply('{not json')).toThrow(ProtocolParseError);
  });

  it('rejects empty lines', () => {
    expect(() => parseReply('   ')).toThrow(ProtocolParseError);
  });

  it('rejects a reply missing requestId', () => {
    expect(() => parseReply(JSON.stringify({ values: {} }))).toThrow();
  });
});

describe('NDJSON protocol event schema', () => {
  it('rejects an event with an unknown type', () => {
    expect(() =>
      assertValidEvent({
        type: 'mystery',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 's',
        timestamp: new Date().toISOString(),
        seq: 1,
      }),
    ).toThrow();
  });

  it('rejects a protocol-version mismatch before it can cause side effects', () => {
    expect(() =>
      assertValidEvent({
        type: 'heartbeat',
        protocolVersion: 999,
        sessionId: 's',
        timestamp: new Date().toISOString(),
        seq: 1,
        step: 'idle',
      }),
    ).toThrow();
  });

  it('rejects a failed event missing a stable code', () => {
    expect(() =>
      assertValidEvent({
        type: 'failed',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 's',
        timestamp: new Date().toISOString(),
        seq: 1,
        code: '',
        message: 'oops',
        retryable: false,
      }),
    ).toThrow();
  });
});
