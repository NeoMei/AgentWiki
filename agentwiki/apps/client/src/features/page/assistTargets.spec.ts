import { describe, expect, it } from 'vitest';
import { captureAssistTarget, resolveAssistTarget, applyScopedCandidate, createCandidateEdits, acceptCandidateEdit } from './assistTargets';
const version = '2026-10-06T00:00:00.000Z';
describe('scoped Agent source edits', () => {
  it('captures UTF16 selections including emoji without changing source offsets', () => {
    expect(captureAssistTarget('a😀bc', 'selection', 1, 3, version)).toMatchObject({ from: 1, to: 3, quote: '😀', prefix: 'a', suffix: 'bc' });
    expect(captureAssistTarget('a😀bc', 'selection', 2, 3, version)).toBeNull();
  });
  it('captures a heading section with its nested headings, ignoring code fences', () => {
    const source = '# One\nintro\n```md\n# Fake\n```\n## Child\nx\n# Two\ny';
    expect(captureAssistTarget(source, 'section', source.indexOf('intro'), source.indexOf('intro'), version)?.quote).toBe('# One\nintro\n```md\n# Fake\n```\n## Child\nx\n');
  });
  it('defaults document to all bytes and refuses invalid or empty selection', () => {
    expect(captureAssistTarget('', 'document', 0, 0, version)?.quote).toBe('');
    expect(captureAssistTarget('abc', 'selection', 1, 1, version)).toBeNull();
    expect(captureAssistTarget('abc', 'selection', -1, 2, version)).toBeNull();
    expect(captureAssistTarget('abc', 'selection', 0, 1, 'bad')).toBeNull();
  });
  it('rejects wrong quote, outside-target changes and overlapping live edits', () => {
    const base = 'before\nquote\nafter'; const target = captureAssistTarget(base, 'selection', 7, 12, version)!;
    expect(applyScopedCandidate(base, 'changed\nnew\nafter', target)).toMatchObject({ status: 'out-of-scope' });
    expect(applyScopedCandidate(base, 'before\nnew\nafter', { ...target, quote: 'wrong' })).toMatchObject({ status: 'invalid-target' });
    expect(applyScopedCandidate(base, 'before\nnew\nafter', target, 'before\nhuman\nafter')).toMatchObject({ status: 'conflict' });
  });
  it('preserves concurrent unrelated text using a unique quote with bounded context', () => {
    const base = 'old' + 'x'.repeat(300) + 'quote' + 'y'.repeat(300) + 'end';
    const target = captureAssistTarget(base, 'selection', 303, 308, version)!;
    expect(applyScopedCandidate(base, base.replace('quote', 'new'), target, base.replace('old', 'human'))).toEqual({ status: 'applied', content: 'human' + 'x'.repeat(300) + 'new' + 'y'.repeat(300) + 'end' });
  });
  it('fails closed on duplicate contextual anchors and retains orphan information', () => {
    const target = { kind: 'selection' as const, from: 0, to: 5, quote: 'quote', prefix: '', suffix: '', baseUpdatedAt: version };
    expect(resolveAssistTarget('quote quote', target).status).toBe('ambiguous');
    expect(resolveAssistTarget('missing', target).status).toBe('orphan');
  });
  it('accepts independent changes once against each live draft and refuses overlap', () => {
    const base = 'one\nkeep\ntwo\n'; const plan = createCandidateEdits(base, 'ONE\nkeep\nTWO\n', captureAssistTarget(base, 'document', 0, 0, version)!);
    expect(plan.status).toBe('ready'); if (plan.status !== 'ready') return;
    expect(plan.edits).toHaveLength(2);
    const first = acceptCandidateEdit(base, plan, plan.edits[0].id, []);
    expect(first).toMatchObject({ status: 'applied', content: 'ONE\nkeep\ntwo\n' });
    if (first.status !== 'applied') return;
    expect(acceptCandidateEdit(first.content, plan, plan.edits[0].id, first.acceptedIds).status).toBe('already-applied');
    expect(acceptCandidateEdit(first.content, plan, plan.edits[1].id, first.acceptedIds)).toMatchObject({ status: 'applied', content: 'ONE\nkeep\nTWO\n' });
    expect(acceptCandidateEdit('one\nkeep\nhuman\n', plan, plan.edits[1].id, []).status).toBe('conflict');
  });
  it('makes a long rewrite one indivisible edit and requires unchanged full source', () => {
    const base = 'a\n'.repeat(301); const target = captureAssistTarget(base, 'document', 0, 0, version)!;
    const plan = createCandidateEdits(base, 'b\n'.repeat(301), target);
    expect(plan).toMatchObject({ status: 'ready', indivisible: true });
    if (plan.status === 'ready') expect(acceptCandidateEdit('human\n' + base, plan, plan.edits[0].id, []).status).toBe('conflict');
  });
});

describe('source edit boundary regressions', () => {
  it('applies single-hunk document change without treating a partial excerpt as a full document', () => {
    const base = 'keep\nold\n'; const plan = createCandidateEdits(base, 'keep\nnew\n', captureAssistTarget(base, 'document', 0, 0, version)!);
    if (plan.status !== 'ready') throw new Error('Expected safe plan');
    expect(acceptCandidateEdit(base, plan, plan.edits[0].id, [])).toMatchObject({ status: 'applied', content: 'keep\nnew\n' });
  });
  it('preserves CRLF byte sequences and accepts pure insertions and deletions', () => {
    for (const [base, candidate] of [['keep\r\nold\r\n', 'keep\r\n'], ['keep\r\n', 'added\r\nkeep\r\n']]) {
      const plan = createCandidateEdits(base, candidate, captureAssistTarget(base, 'document', 0, 0, version)!);
      if (plan.status !== 'ready') throw new Error('Expected safe plan');
      expect(acceptCandidateEdit(base, plan, plan.edits[0].id, [])).toMatchObject({ status: 'applied', content: candidate });
    }
  });
  it('accepts independent edits in reverse order', () => {
    const base = 'one\nkeep\ntwo\n'; const plan = createCandidateEdits(base, 'ONE\nkeep\nTWO\n', captureAssistTarget(base, 'document', 0, 0, version)!);
    if (plan.status !== 'ready') throw new Error('Expected safe plan');
    const last = acceptCandidateEdit(base, plan, plan.edits[1].id, []);
    if (last.status !== 'applied') throw new Error('Expected apply');
    expect(acceptCandidateEdit(last.content, plan, plan.edits[0].id, last.acceptedIds)).toMatchObject({ status: 'applied', content: 'ONE\nkeep\nTWO\n' });
  });
});
