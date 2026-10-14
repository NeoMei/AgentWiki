import type { Language } from '../../i18n/messages';

const messages: Record<Language, Record<string, string>> = {
  en: {
    'collaboration.sortCreatedDesc': 'Newest created first · time shown: created at',
    'collaboration.createdAt': 'Created at',
  },
  'zh-CN': {
    'collaboration.sortCreatedDesc': '按创建时间倒序 · 显示时间：创建时间',
    'collaboration.createdAt': '创建时间',
  },
};

export function runOrderText(language: Language, key: string, params?: Record<string, string | number>): string | undefined {
  const template = messages[language][key] ?? messages.en[key];
  if (template === undefined) return undefined;
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.split(`{${name}}`).join(String(replacement)),
    template,
  );
}
