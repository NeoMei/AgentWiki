import { outlineFor } from '../../components/markdown-tools/outline';
export interface AssistTarget {
  kind: 'selection' | 'section' | 'document';
  from: number; to: number; quote: string; prefix: string; suffix: string; baseUpdatedAt: string;
}
const boundary = (text: string, at: number) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]));
const validShape = (t: AssistTarget) => t && ['selection', 'section', 'document'].includes(t.kind)
  && Number.isSafeInteger(t.from) && Number.isSafeInteger(t.to) && t.from >= 0 && t.to >= t.from
  && typeof t.quote === 'string' && t.to - t.from === t.quote.length && typeof t.prefix === 'string' && typeof t.suffix === 'string'
  && t.prefix.length <= 256 && t.suffix.length <= 256 && typeof t.baseUpdatedAt === 'string' && Number.isFinite(Date.parse(t.baseUpdatedAt));
const anchor = (source: string, from: number, to: number, baseUpdatedAt: string, kind: AssistTarget['kind']): AssistTarget => ({
  kind, from, to, quote: source.slice(from, to), prefix: source.slice(Math.max(0, from - 256), from), suffix: source.slice(to, to + 256), baseUpdatedAt,
});
/** CodeMirror and JavaScript offsets are UTF16. Never split a surrogate pair. */
export function captureAssistTarget(source: string, kind: AssistTarget['kind'], from: number, to: number, baseUpdatedAt: string): AssistTarget | null {
  if (!Number.isFinite(Date.parse(baseUpdatedAt)) || !['selection', 'section', 'document'].includes(kind)) return null;
  if (kind === 'document') return anchor(source, 0, source.length, baseUpdatedAt, kind);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > source.length || !boundary(source, from) || !boundary(source, to)) return null;
  if (kind === 'section') {
    const headings = outlineFor(source);
    const preceding = headings.filter((h) => h.from <= from);
    const heading = preceding[preceding.length - 1];
    if (!heading) return null;
    from = heading.from;
    to = headings.find((h) => h.from > from && h.level <= heading.level)?.from ?? source.length;
  }
  return from === to ? null : anchor(source, from, to, baseUpdatedAt, kind);
}
export function validateAssistTarget(source: string, target: AssistTarget): boolean {
  return !!validShape(target) && target.to <= source.length && boundary(source, target.from) && boundary(source, target.to)
    && (target.kind === 'document' ? target.from === 0 && target.to === source.length : target.to > target.from)
    && source.slice(target.from, target.to) === target.quote
    && target.prefix.length <= target.from && source.slice(target.from - target.prefix.length, target.from) === target.prefix
    && source.slice(target.to, target.to + target.suffix.length) === target.suffix;
}
export type AnchorResult = { status: 'found'; from: number; to: number } | { status: 'orphan' | 'ambiguous' | 'invalid-target' };
/** Positions are advisory after human edits; only a unique exact contextual anchor authorizes application. */
export function resolveAssistTarget(source: string, target: AssistTarget): AnchorResult {
  if (!validShape(target)) return { status: 'invalid-target' };
  if (target.kind === 'document') return source === target.quote ? { status: 'found', from: 0, to: source.length } : { status: 'orphan' };
  const needle = target.prefix + target.quote + target.suffix;
  if (!needle) return { status: 'ambiguous' };
  const at = source.indexOf(needle);
  if (at < 0) return { status: 'orphan' };
  if (source.indexOf(needle, at + 1) >= 0) return { status: 'ambiguous' };
  const from = at + target.prefix.length, to = from + target.quote.length;
  return boundary(source, from) && boundary(source, to) ? { status: 'found', from, to } : { status: 'invalid-target' };
}
export type ApplyResult = { status: 'applied'; content: string } | { status: 'invalid-target' | 'out-of-scope' | 'conflict' | 'ambiguous' };
function candidateReplacement(base: string, candidate: string, target: AssistTarget): { status: 'valid'; replacement: string } | { status: 'invalid-target' | 'out-of-scope' } {
  if (!validateAssistTarget(base, target)) return { status: 'invalid-target' };
  const prefix = base.slice(0, target.from), suffix = base.slice(target.to);
  if (candidate.length < prefix.length + suffix.length || !candidate.startsWith(prefix) || !candidate.endsWith(suffix)) return { status: 'out-of-scope' };
  return { status: 'valid', replacement: candidate.slice(prefix.length, candidate.length - suffix.length) };
}
export function applyScopedCandidate(base: string, candidate: string, target: AssistTarget, live = base): ApplyResult {
  const result = candidateReplacement(base, candidate, target);
  if (result.status !== 'valid') return result;
  const location = resolveAssistTarget(live, target);
  if (location.status !== 'found') return { status: location.status === 'ambiguous' ? 'ambiguous' : 'conflict' };
  return { status: 'applied', content: live.slice(0, location.from) + result.replacement + live.slice(location.to) };
}
export interface CandidateEdit { id: string; from: number; to: number; before: string; after: string }
export interface CandidateEditPlan { status: 'ready'; base: string; target: AssistTarget; edits: CandidateEdit[]; indivisible: boolean }
/** Bounded LCS over source lines INCLUDING separators: applying a hunk never normalizes Markdown. */
export function createCandidateEdits(base: string, candidate: string, target: AssistTarget): CandidateEditPlan | { status: 'invalid-target' | 'out-of-scope' } {
  const result = candidateReplacement(base, candidate, target);
  if (result.status !== 'valid') return result;
  const before = target.quote, after = result.replacement;
  const left = before.match(/[^\n]*\n|[^\n]+$/g) ?? [], right = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const edits: CandidateEdit[] = [];
  const add = (from: number, to: number, oldText: string, newText: string) => edits.push({ id: `edit-${edits.length + 1}`, from, to, before: oldText, after: newText });
  const indivisible = left.length > 300 || right.length > 300 || before.length + after.length > 100_000;
  if (indivisible) { if (before !== after) add(target.from, target.to, before, after); }
  else {
    const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) rows[i][j] = left[i] === right[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    let i = 0, j = 0, offset = target.from, start = offset, oldText = '', newText = '';
    const flush = () => { if (oldText || newText) add(start, offset, oldText, newText); oldText = ''; newText = ''; start = offset; };
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { flush(); offset += left[i++].length; j++; start = offset; }
      else if (i < left.length && (j === right.length || rows[i + 1][j] >= rows[i][j + 1])) { oldText += left[i]; offset += left[i++].length; }
      else newText += right[j++];
    }
    flush();
  }
  return { status: 'ready', base, target, edits, indivisible: indivisible || edits.length <= 1 };
}
export type EditAcceptance = { status: 'applied'; content: string; acceptedIds: string[] } | { status: 'already-applied' | 'conflict' | 'ambiguous' | 'invalid-target' };
/** Caller persists acceptedIds with the candidate, updates source and ids atomically, and enforces identity/version/permission. */
export function acceptCandidateEdit(live: string, plan: CandidateEditPlan, editId: string, acceptedIds: readonly string[]): EditAcceptance {
  const edit = plan.edits.find((e) => e.id === editId);
  if (!edit || acceptedIds.some((id) => !plan.edits.some((e) => e.id === id))) return { status: 'invalid-target' };
  if (acceptedIds.includes(editId)) return { status: 'already-applied' };
  let expected = plan.base;
  for (const prior of plan.edits.filter((e) => acceptedIds.includes(e.id)).sort((a, b) => b.from - a.from)) expected = expected.slice(0, prior.from) + prior.after + expected.slice(prior.to);
  const shift = plan.edits.filter((e) => acceptedIds.includes(e.id) && e.to <= edit.from).reduce((sum, e) => sum + e.after.length - e.before.length, 0);
  const from = edit.from + shift;
  const target = anchor(expected, from, from + edit.before.length, plan.target.baseUpdatedAt, plan.indivisible && plan.target.kind === 'document' && edit.from === 0 && edit.to === plan.base.length ? 'document' : 'selection');
  const location = resolveAssistTarget(live, target);
  if (location.status !== 'found') return { status: location.status === 'ambiguous' ? 'ambiguous' : 'conflict' };
  return { status: 'applied', content: live.slice(0, location.from) + edit.after + live.slice(location.to), acceptedIds: [...acceptedIds, editId] };
}
