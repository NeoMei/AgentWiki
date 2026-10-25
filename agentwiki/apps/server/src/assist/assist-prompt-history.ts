import { AgentHistoryTurn } from './assist-session.types';

/**
 * Encode replay history without repeating identical captured source bodies.
 * The database keeps the original lossless turns; this is only a prompt
 * representation. A body is replaced only when the exact same string occurs
 * at least twice and is large enough for the indirection to save space.
 */
export function serializePromptHistory(
  history: AgentHistoryTurn[],
  window?: Record<string, unknown>,
): string {
  const occurrences = new Map<string, number>();
  const count = (value: unknown) => {
    if (typeof value === 'string' && value.length >= 256) occurrences.set(value, (occurrences.get(value) || 0) + 1);
  };
  history.forEach((turn) => {
    count((turn.pageSnapshot as Record<string, unknown> | null | undefined)?.content);
    turn.references.forEach((reference) => count(reference.content));
  });

  const sourceBodies: Record<string, string> = {};
  const sourceIds = new Map<string, string>();
  const bodyReference = (body: string): string => {
    const existing = sourceIds.get(body);
    if (existing) return existing;
    const id = `source-${Object.keys(sourceBodies).length}`;
    sourceIds.set(body, id); sourceBodies[id] = body;
    return id;
  };
  const encodeSource = (source: Record<string, unknown>): Record<string, unknown> => {
    const body = source.content;
    if (typeof body !== 'string' || (occurrences.get(body) || 0) < 2 || Object.prototype.hasOwnProperty.call(source, 'contentSource')) return { ...source };
    const { content: _content, ...metadata } = source;
    return { ...metadata, contentSource: bodyReference(body) };
  };
  const turns = history.map((turn) => {
    const pageSnapshot = turn.pageSnapshot && typeof turn.pageSnapshot === 'object'
      ? encodeSource(turn.pageSnapshot as Record<string, unknown>) : turn.pageSnapshot;
    const references = turn.references.map((reference) => encodeSource(reference as unknown as Record<string, unknown>));
    return { ...turn, pageSnapshot, references };
  });
  const payload: Record<string, unknown> = {
    ...(window ? { window } : {}),
    turns,
    ...(Object.keys(sourceBodies).length ? { sourceBodies } : {}),
  };
  return JSON.stringify(payload);
}
