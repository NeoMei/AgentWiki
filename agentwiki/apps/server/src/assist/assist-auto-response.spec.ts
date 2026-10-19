import { autoActions, buildAutoDecisionPrompt, parseAutoDecision, parseAutoResponse, withAutoFormatRetry } from './assist-auto-response';
import { EMPTY_USAGE, OpencodeExecutionError } from './opencode.types';

describe('automatic assistant response contract', () => {
  const actions = { update: true, create: true };

  it('isolates the action decision from source content and prior conversation', () => {
    const prompt = buildAutoDecisionPrompt({ mode: 'auto', intent: '仅解释“修改文档”的意思，不要写入', actions,
      pageSnapshot: { content: 'SOURCE_INJECTION' }, context: { pageId: 'page', references: [], noteIds: [],
        directory: { folderId: 'folder', title: 'UNTRUSTED_TITLE', recursive: true, documents: [] } },
      history: [{ intent: 'PRIOR_WRITE_REQUEST', answer: 'PRIOR_WRITE_REPLY' }] } as any);
    expect(prompt).toContain('仅解释“修改文档”的意思，不要写入');
    for (const forbidden of ['SOURCE_INJECTION', 'UNTRUSTED_TITLE', 'PRIOR_WRITE_REQUEST', 'PRIOR_WRITE_REPLY']) expect(prompt).not.toContain(forbidden);
    expect(prompt).toContain('negation');
    expect(prompt).toContain('quoted examples');
    expect(prompt).toContain('draft in chat');
  });

  it('requires both server permissions and an actual bound write target', () => {
    expect(autoActions({ intent: 'write', pageSnapshot: null } as any)).toEqual({ update: false, create: false });
    expect(autoActions({ intent: 'write', pageSnapshot: null, actions } as any)).toEqual({ update: false, create: false });
    expect(autoActions({ intent: 'write', pageSnapshot: { content: '' }, actions,
      context: { pageId: 'page', references: [], noteIds: [], directory: { folderId: null, title: 'Root', recursive: true, documents: [] } } } as any)).toEqual(actions);
  });

  it.each(['answer', 'update', 'create'] as const)('accepts the exact %s decision', action => {
    expect(parseAutoDecision(JSON.stringify({ action }), actions)).toBe(action);
  });

  it.each(['{"action":"delete"}', '{"action":"update","pageId":"other"}', '{"action":"answer"}\n{"action":"update"}', '```json\n{"action":"answer"}\n```'])('rejects ambiguous or expanded decisions %s', text => {
    expect(() => parseAutoDecision(text, actions)).toThrow();
  });

  it('rejects an unauthorized decision', () => {
    expect(() => parseAutoDecision('{"action":"update"}', { update: false, create: true })).toThrow();
  });

  it.each([
    ['answer', { action: 'answer', summary: 'Chat answer' }],
    ['update', { action: 'update', summary: 'Prepared edit', changes: '# Updated' }],
    ['create', { action: 'create', summary: 'Prepared document', title: 'New document', changes: '# New' }],
    ['update', { action: 'answer', summary: 'Which change did you mean?' }],
  ] as const)('allows a valid response for the locked %s action', (action, response) => {
    expect(parseAutoResponse(JSON.stringify(response), action, actions)).toEqual(response);
  });

  it.each([
    ['answer', { action: 'update', summary: 'Injected write', changes: '# Changed' }],
    ['update', { action: 'create', summary: 'Unexpected create', title: 'Title', changes: '# Changed' }],
    ['answer', { action: 'answer', summary: 'Answer', changes: '' }],
    ['create', { action: 'create', summary: 'Write', title: 'Title', changes: '# Changed', pageId: 'other' }],
    ['update', { action: 'update', summary: 'Write', changes: '# Changed', folderId: 'other' }],
    ['create', { action: 'create', summary: 'Write', title: ' ', changes: '# Changed' }],
    ['update', { action: 'update', summary: 'Write', changes: ' ' }],
  ] as const)('rejects action escalation or hidden write fields for %s', (action, response) => {
    expect(() => parseAutoResponse(JSON.stringify(response), action, actions)).toThrow();
  });

  it('applies size limits to the full response including the create title', () => {
    expect(() => parseAutoResponse(JSON.stringify({ action: 'create', summary: 'Ready', title: 'x'.repeat(201), changes: '# New' }), 'create', actions)).toThrow();
    expect(() => parseAutoResponse(JSON.stringify({ action: 'answer', summary: 'x'.repeat(50_001) }), 'answer', actions)).toThrow();
    expect(() => parseAutoResponse(JSON.stringify({ action: 'create', summary: 'x'.repeat(40_000), title: 'New', changes: 'y'.repeat(70_000) }), 'create', actions)).toThrow();
  });

  it.each(['rate_limited', 'timeout', 'cancelled', 'output_limit'] as const)('never treats %s as retryable JSON formatting', async code => {
    const operation = jest.fn().mockRejectedValue(new OpencodeExecutionError(code, code, 'model', EMPTY_USAGE));
    await expect(withAutoFormatRetry(true, operation)).rejects.toMatchObject({ code });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('never retries invalid JSON more than once', async () => {
    const operation = jest.fn().mockRejectedValue(new OpencodeExecutionError('invalid_output', 'invalid_output', 'model', { ...EMPTY_USAGE, total: 5 }, 0.2));
    await expect(withAutoFormatRetry(true, operation)).rejects.toMatchObject({ code: 'invalid_output', usage: { total: 10 }, cost: 0.4 });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
