import { describe, expect, it } from 'vitest';
import { buildAssistTask } from './assistTask';

const base = { baseUrl: 'http://localhost:3000/api', pageId: 'pg123', pageTitle: 'Test Page', intent: 'Polish the intro' };

describe('buildAssistTask', () => {
  it('zh: contains page id, intent and propose_page guidance', () => {
    const text = buildAssistTask(base, true);
    expect(text).toContain('pg123');
    expect(text).toContain('Polish the intro');
    expect(text).toContain('propose_page');
    expect(text).toContain('get_page');
    expect(text).toContain('人工审批');
  });
  it('en: contains page id, intent and propose_page guidance', () => {
    const text = buildAssistTask(base, false);
    expect(text).toContain('pg123');
    expect(text).toContain('propose_page');
    expect(text).toContain('human review');
  });
});
