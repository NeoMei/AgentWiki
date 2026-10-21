import { useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { templateEntryMessages } from '../../i18n/templateEntryMessages';

/** Keep template-only copy in the feature chunk while sharing the persisted language context. */
export function useTemplateEntryLanguage() {
  const context = useLanguage();
  const { language, t: sharedT } = context;
  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    const template = templateEntryMessages[language][key];
    if (template === undefined) return sharedT(key, params);
    return Object.entries(params ?? {}).reduce((value, [name, replacement]) =>
      value.split(`{${name}}`).join(String(replacement)), template);
  }, [language, sharedT]);
  return { ...context, t };
}
