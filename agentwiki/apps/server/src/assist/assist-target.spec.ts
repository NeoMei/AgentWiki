import { assertAssistOutputScope, normalizeAssistOutputScope, validateAssistTarget } from './assist-target';

const updatedAt = '2026-01-01T00:00:00.000Z';
function snapshot(patch: Record<string, unknown> = {}) {
  return { content: 'pre OLD post', updatedAt, assistTarget: {
    kind: 'selection', from: 4, to: 7, quote: 'OLD', prefix: 'pre ', suffix: ' post', baseUpdatedAt: updatedAt,
    ...patch,
  } };
}

describe('Assist source scope validation', () => {
  it.each([
    { from: Infinity }, { to: -Infinity }, { to: 6.5 }, { from: '4' },
    { quote: null }, { prefix: null }, { suffix: null }, { suffix: 'x'.repeat(257) },
    { prefix: ' pre ' }, { suffix: ' post ' }, { baseUpdatedAt: null },
  ])('rejects invalid or over-bound context %j', (patch) => {
    expect(() => validateAssistTarget(snapshot(patch))).toThrow('Invalid Assist target');
  });

  it.each([null, [], false, 'selection', {}])('rejects malformed target shape %j', (assistTarget) => {
    expect(() => validateAssistTarget({ content: '', updatedAt, assistTarget })).toThrow('Invalid Assist target');
  });

  it('accepts exact immediately adjacent partial context instead of requiring whole outside text', () => {
    expect(validateAssistTarget(snapshot({ prefix: 'e ', suffix: ' p' }))).toMatchObject({ from: 4, to: 7 });
  });

  it('treats missing target as legitimate legacy whole-document input', () => {
    expect(validateAssistTarget({ content: 'legacy' })).toBeUndefined();
    expect(() => assertAssistOutputScope({ content: 'legacy' }, 'entirely rewritten')).not.toThrow();
  });

  it('rejects a rewritten far-away prefix even when supplied short target context remains intact', () => {
    expect(() => assertAssistOutputScope(snapshot({ prefix: ' ', suffix: ' ' }), 'bad NEW post')).toThrow('outside the target');
  });

  it('allows deletion of the entire selected range while preserving its outside source', () => {
    expect(() => assertAssistOutputScope(snapshot(), 'pre  post')).not.toThrow();
  });

  it('rebuilds the saved outside source when a provider drifts beyond bounded anchors', () => {
    const raw = 'pre NEW post\nprovider-normalized-outside-target';
    const normalized = normalizeAssistOutputScope(snapshot(), raw);
    expect(normalized).toBe('pre NEW post');
    expect(() => assertAssistOutputScope(snapshot(), normalized)).not.toThrow();
  });

  it('does not repair ambiguous bounded anchors', () => {
    const target = snapshot({ prefix: ' ', suffix: ' ' });
    const raw = 'bad NEW post and another space';
    expect(normalizeAssistOutputScope(target, raw)).toBe(raw);
    expect(() => assertAssistOutputScope(target, raw)).toThrow('outside the target');
  });
});
