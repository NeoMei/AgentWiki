import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { exactRemoteToolSchema } from './collaboration-tools.js';

describe('exact collaboration gateway schemas', () => {
  it('maps all six remote names to strict direct schemas', () => {
    const names = [
      'collaboration_join_run', 'collaboration_next_action', 'collaboration_heartbeat',
      'collaboration_update_todo', 'collaboration_submit_result', 'collaboration_get_run',
    ];
    for (const name of names) expect(exactRemoteToolSchema(name)).toBeDefined();
    const schema = z.object(exactRemoteToolSchema('collaboration_next_action')!).strict();
    expect(() => schema.parse({ runId: 'run-1', idempotencyKey: 'next-0001' })).not.toThrow();
    expect(() => schema.parse({ __args: { runId: 'run-1' } })).toThrow();
  });

  it('does not reinterpret unrelated remote tool schemas', () => {
    expect(exactRemoteToolSchema('list_pages')).toBeUndefined();
  });
});
