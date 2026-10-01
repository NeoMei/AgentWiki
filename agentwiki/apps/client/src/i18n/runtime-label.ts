import type { Translate } from '../api/error-message';
const STATES = new Set(['active', 'paused', 'queued', 'reserved', 'fetching', 'extracting', 'compiling', 'indexing', 'completed', 'failed', 'partial', 'cancelled', 'pending', 'submitted', 'accepted', 'rejected', 'superseded']);
export function runtimeLabel(value: string | null | undefined, t: Translate): string {
  return t(STATES.has(value ?? '') ? `runtime.${value}` : 'common.notAvailable');
}
