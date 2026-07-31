import { createHash } from 'node:crypto';

/**
 * Deterministic stable ID generation.
 *
 * Produces a 32-hex-character identifier by hashing a namespaced key.
 * This is intentionally not a standard UUID so it can be stable across
 * adapters and spaces without parsing collisions.
 */
export function stableId(namespace: string, key: string): string {
  const input = `${namespace}:${key}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export function artifactId(adapterId: string, spaceId: string, logicalKey: string): string {
  return stableId('agentwiki:artifact', `${adapterId}:${spaceId}:${logicalKey}`);
}

export function pageId(spaceId: string, identityKey: string): string {
  return stableId('agentwiki:page', `${spaceId}:${identityKey}`);
}

export function memoryId(spaceId: string, key: string): string {
  return stableId('agentwiki:memory', `${spaceId}:${key}`);
}

export function relationId(spaceId: string, sourceId: string, targetId: string, relationType: string): string {
  return stableId('agentwiki:relation', `${spaceId}:${sourceId}:${targetId}:${relationType}`);
}
