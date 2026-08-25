import { createHash } from 'crypto';
import { z } from 'zod';

export const PageTemplateLocaleSchema = z.enum(['zh-CN', 'en']);
export type PageTemplateLocale = z.infer<typeof PageTemplateLocaleSchema>;

export const LocalizedValueSchema = z.object({
  'zh-CN': z.string().max(200_000).optional(),
  en: z.string().max(200_000).optional(),
}).strict().refine((value) => value['zh-CN'] !== undefined || value.en !== undefined, {
  message: 'At least one localization is required',
});
export type LocalizedValue = z.infer<typeof LocalizedValueSchema>;

export function systemLocalizedValue(value: unknown): Required<LocalizedValue> {
  const parsed = LocalizedValueSchema.parse(value);
  if (parsed['zh-CN'] === undefined || parsed.en === undefined) {
    throw new TypeError('System page templates require zh-CN and en');
  }
  return { 'zh-CN': parsed['zh-CN'], en: parsed.en };
}

export function localizedValue(
  value: unknown,
  requested: PageTemplateLocale,
  fallback: PageTemplateLocale,
): string {
  const parsed = LocalizedValueSchema.parse(value);
  return parsed[requested] ?? parsed[fallback] ?? parsed.en ?? parsed['zh-CN']!;
}

export function normalizeTemplateName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

export function templateContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
