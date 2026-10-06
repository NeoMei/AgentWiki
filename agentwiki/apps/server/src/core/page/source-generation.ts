/** Actual body, format or source association changes invalidate prior source review. */
export function sourceGenerationInvalidation(before: Record<string, any>, changes: Record<string, any>): { sourceGeneration?: null } {
  return ['content', 'format', 'sourceId', 'sourceVersionId', 'sourcePath'].some(key =>
    changes[key] !== undefined && (before[key] ?? null) !== (changes[key] ?? null),
  ) ? { sourceGeneration: null } : {};
}
