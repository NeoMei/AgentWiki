import { serializePromptHistory } from './assist-prompt-history';
import { AgentHistoryTurn } from './assist-session.types';

const turn = (content: string, overrides: Partial<AgentHistoryTurn> = {}): AgentHistoryTurn => ({
  intent: 'update the report', answer: '', mode: 'auto', status: 'failed', pageId: 'page',
  pageSnapshot: { title: 'Report', content, updatedAt: '2026-10-25T00:00:00.000Z' }, references: [], ...overrides,
});

describe('lossless model history encoding', () => {
  it('stores repeated large bodies once while preserving each turn and source version', () => {
    const content = 'old report content\n'.repeat(1_000);
    const history = Array.from({ length: 10 }, (_, index) => turn(content, { intent: `request ${index}` }));
    const before = JSON.stringify(history);
    const encoded = serializePromptHistory(history, { included: 10 });
    const value = JSON.parse(encoded);
    expect(encoded.length).toBeLessThan(before.length / 4);
    expect(value.turns).toHaveLength(10);
    expect(Object.values(value.sourceBodies)).toEqual([content]);
    for (let index = 0; index < history.length; index += 1) {
      const { contentSource, ...snapshot } = value.turns[index].pageSnapshot;
      expect({ ...value.turns[index], pageSnapshot: { ...snapshot, content: value.sourceBodies[contentSource] } }).toEqual(history[index]);
    }
    expect(JSON.stringify(history)).toBe(before);
  });

  it('keeps different drafts and old versions exactly, including matching metadata with different content', () => {
    const a = 'first version\n'.repeat(200), b = 'second version\n'.repeat(200);
    const history = [turn(a), turn(b), turn(a, { pageId: 'another-page', references: [{ pageId: 'reference', title: 'Reference', updatedAt: 'old', content: a }] })];
    const value = JSON.parse(serializePromptHistory(history));
    expect(value.turns[1].pageSnapshot.content).toBe(b);
    expect(value.sourceBodies[value.turns[0].pageSnapshot.contentSource]).toBe(a);
    expect(value.sourceBodies[value.turns[2].references[0].contentSource]).toBe(a);
    expect(value.turns[2].references[0].updatedAt).toBe('old');
  });

  it('leaves small or unique bodies and all conversation text unchanged', () => {
    const history = [turn('short', { answer: 'answer', changes: 'proposal', annotations: [{ id: 'note', body: 'comment', quote: 'short' }] }), turn('short')];
    expect(JSON.parse(serializePromptHistory(history, { omitted: 2 }))).toEqual({ window: { omitted: 2 }, turns: history });
  });

  it('does not overwrite an existing source marker in untrusted snapshot metadata', () => {
    const content = 'body'.repeat(1_000);
    const history = [turn(content), turn(content, { pageSnapshot: { content, contentSource: 'untrusted-label' } })];
    expect(JSON.parse(serializePromptHistory(history)).turns[1].pageSnapshot).toEqual(history[1].pageSnapshot);
  });
});
