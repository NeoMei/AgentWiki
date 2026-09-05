import {
  CollaborationInputValuesSchema,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';

export function parseCollaborationInputs(
  definition: CollaborationTemplateDefinition,
  raw: unknown,
): Record<string, string | number | boolean> {
  const parsed = CollaborationInputValuesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: parsed.error.issues });
  }
  const definitions = new Map(definition.inputs.map((input) => [input.key, input]));
  const issues: string[] = [];
  for (const key of Object.keys(parsed.data)) if (!definitions.has(key)) issues.push(`Unknown input: ${key}`);
  for (const input of definition.inputs) {
    const value = parsed.data[input.key];
    if (input.required && value === undefined) issues.push(`Required input is missing: ${input.key}`);
    if (value === undefined) continue;
    if (input.type === 'number' && typeof value !== 'number') issues.push(`${input.key} must be a number`);
    if (input.type === 'boolean' && typeof value !== 'boolean') issues.push(`${input.key} must be a boolean`);
    if (!['number', 'boolean'].includes(input.type) && typeof value !== 'string') issues.push(`${input.key} must be text`);
    if (input.type === 'url' && (typeof value !== 'string' || !isHttpsUrl(value))) {
      issues.push(`${input.key} must be an HTTPS URL`);
    }
  }
  if (issues.length > 0) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
  return Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => {
    const input = definitions.get(key)!;
    return input.type === 'url' && typeof value === 'string'
      ? [key, new URL(value).toString()]
      : [key, value];
  }));
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
