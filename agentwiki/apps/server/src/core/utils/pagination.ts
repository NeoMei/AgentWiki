export function parseOffset(value: string | undefined): number {
  const parsed = value === undefined ? 0 : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseLimit(value: string | undefined, fallback = 20, maximum = 100): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}
