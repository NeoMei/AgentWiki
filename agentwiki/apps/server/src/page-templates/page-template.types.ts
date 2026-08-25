import { createHash } from 'crypto';
import { maxLength } from 'class-validator';
import { z } from 'zod';

export const PageTemplateLocaleSchema = z.enum(['zh-CN', 'en']);
export type PageTemplateLocale = z.infer<typeof PageTemplateLocaleSchema>;

export const PageTemplateContentSchema = z.string().refine(
  (value) => maxLength(value, 200_000),
  { message: 'Template content exceeds the page content limit' },
);

export const LocalizedValueSchema = z.object({
  'zh-CN': PageTemplateContentSchema.optional(),
  en: PageTemplateContentSchema.optional(),
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

export function resolveLocalizedValue(
  value: unknown,
  policy:
    | { scope: 'system'; requested: PageTemplateLocale }
    | { scope: 'space'; sourceLocale: PageTemplateLocale },
): { value: string; locale: PageTemplateLocale } {
  const parsed = LocalizedValueSchema.parse(value);
  const locale = policy.scope === 'system'
    ? (parsed[policy.requested] !== undefined ? policy.requested : 'en')
    : policy.sourceLocale;
  return { value: z.string().parse(parsed[locale]), locale };
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
