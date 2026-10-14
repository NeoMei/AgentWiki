import type { Language } from '../../i18n/messages';

const messages: Record<Language, Record<string, string>> = {
  en: {
    'pageTemplate.sourceMatches': 'Matching pages: {count}',
    'pageTemplate.sourceNoMatches': 'No matching pages found',
    'pageTemplate.sourceSelected': 'Selected: {page}',
  },
  'zh-CN': {
    'pageTemplate.sourceMatches': '匹配页面：{count}',
    'pageTemplate.sourceNoMatches': '未找到匹配页面',
    'pageTemplate.sourceSelected': '已选择：{page}',
  },
};

export function sourceSelectionText(language: Language, key: string, params?: Record<string, string | number>): string | undefined {
  const template = messages[language][key] ?? messages.en[key];
  if (template === undefined) return undefined;
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.split(`{${name}}`).join(String(replacement)),
    template,
  );
}
