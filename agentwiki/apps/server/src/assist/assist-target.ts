import { BadRequestException } from '@nestjs/common';

export interface AssistTarget {
  kind: 'selection' | 'section' | 'document';
  from: number;
  to: number;
  quote: string;
  prefix: string;
  suffix: string;
  baseUpdatedAt: string;
}

function invalidTarget(): never {
  throw new BadRequestException('Invalid Assist target');
}

/** Offsets are JavaScript/CodeMirror UTF-16 source offsets, not quote searches.
 * A draft may differ from the saved page; only its saved base version binds it. */
export function validateAssistTarget(snapshot: unknown): AssistTarget | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  if (JSON.stringify(snapshot).length > 50_000) throw new BadRequestException('Page snapshot is too large');
  if (!Object.prototype.hasOwnProperty.call(snapshot, 'assistTarget')) return undefined;
  const { content, updatedAt, assistTarget } = snapshot as Record<string, unknown>;
  if (typeof content !== 'string' || !assistTarget || typeof assistTarget !== 'object' || Array.isArray(assistTarget)) invalidTarget();
  const target = assistTarget as AssistTarget;
  if (
    !['selection', 'section', 'document'].includes(target.kind) ||
    !Number.isSafeInteger(target.from) || !Number.isSafeInteger(target.to) ||
    target.from < 0 || target.to < target.from || target.to > content.length ||
    typeof target.quote !== 'string' || typeof target.prefix !== 'string' || typeof target.suffix !== 'string' ||
    target.prefix.length > 256 || target.suffix.length > 256 ||
    typeof target.baseUpdatedAt !== 'string' || target.baseUpdatedAt !== updatedAt ||
    !Number.isFinite(Date.parse(target.baseUpdatedAt))
  ) invalidTarget();
  if (target.kind === 'document' ? target.from !== 0 || target.to !== content.length : target.from === target.to) invalidTarget();
  if (
    content.slice(target.from, target.to) !== target.quote ||
    target.prefix.length > target.from || target.suffix.length > content.length - target.to ||
    content.slice(target.from - target.prefix.length, target.from) !== target.prefix ||
    content.slice(target.to, target.to + target.suffix.length) !== target.suffix
  ) invalidTarget();
  return target;
}

export function assertAssistTargetVersion(target: AssistTarget | undefined, updatedAt: Date): void {
  if (target && Date.parse(target.baseUpdatedAt) !== updatedAt.getTime()) {
    throw new BadRequestException('Assist page version has changed');
  }
}

/** Verify the complete source around the target, not merely the bounded context.
 * Length guards prevent prefix/suffix overlap from masquerading as preservation. */
export function assertAssistOutputScope(snapshot: unknown, changes: unknown): void {
  const target = validateAssistTarget(snapshot);
  if (!target) return;
  const source = (snapshot as { content: string }).content;
  const prefix = source.slice(0, target.from);
  const suffix = source.slice(target.to);
  if (typeof changes !== 'string' || changes.length < prefix.length + suffix.length || !changes.startsWith(prefix) || !changes.endsWith(suffix)) {
    throw new BadRequestException('Assist output changed content outside the target');
  }
}
