import {
  CollaborationInputValuesSchema,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';

export function parseCollaborationInputs(
  definition: CollaborationTemplateDefinition,
  raw: unknown,
): Record<string, string | number | boolean> {
  const inspected = inspectCollaborationInputs(definition, raw);
  if (inspected.issues.length > 0) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: inspected.issues });
  }
  return inspected.values;
}

export type CollaborationInputIssue = {
  code:
    | 'COLLABORATION_INPUT_INVALID'
    | 'COLLABORATION_INPUT_UNKNOWN'
    | 'COLLABORATION_INPUT_REQUIRED'
    | 'COLLABORATION_INPUT_TYPE_INVALID'
    | 'COLLABORATION_INPUT_URL_INVALID';
  inputKey?: string;
};

export function inspectCollaborationInputs(
  definition: CollaborationTemplateDefinition,
  raw: unknown,
): { values: Record<string, string | number | boolean>; issues: CollaborationInputIssue[] } {
  const parsed = CollaborationInputValuesSchema.safeParse(raw);
  if (!parsed.success) {
    return { values: {}, issues: [{ code: 'COLLABORATION_INPUT_INVALID' }] };
  }
  const definitions = new Map(definition.inputs.map((input) => [input.key, input]));
  const issues: CollaborationInputIssue[] = [];
  for (const key of Object.keys(parsed.data).sort()) {
    if (!definitions.has(key)) issues.push({ code: 'COLLABORATION_INPUT_UNKNOWN', inputKey: key });
  }
  for (const input of definition.inputs) {
    const value = parsed.data[input.key];
    if (input.required && value === undefined) {
      issues.push({ code: 'COLLABORATION_INPUT_REQUIRED', inputKey: input.key });
    }
    if (value === undefined) continue;
    if (input.type === 'number' && typeof value !== 'number') {
      issues.push({ code: 'COLLABORATION_INPUT_TYPE_INVALID', inputKey: input.key });
    }
    if (input.type === 'boolean' && typeof value !== 'boolean') {
      issues.push({ code: 'COLLABORATION_INPUT_TYPE_INVALID', inputKey: input.key });
    }
    if (!['number', 'boolean'].includes(input.type) && typeof value !== 'string') {
      issues.push({ code: 'COLLABORATION_INPUT_TYPE_INVALID', inputKey: input.key });
    }
    if (input.type === 'url' && (typeof value !== 'string' || !isHttpsUrl(value))) {
      issues.push({ code: 'COLLABORATION_INPUT_URL_INVALID', inputKey: input.key });
    }
  }
  const values = Object.fromEntries(Object.entries(parsed.data).flatMap(([key, value]) => {
    if (!definitions.has(key)) return [];
    const input = definitions.get(key)!;
    return input.type === 'url' && typeof value === 'string'
      ? [[key, isHttpsUrl(value) ? new URL(value).toString() : value] as const]
      : [[key, value] as const];
  }));
  return { values, issues };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
