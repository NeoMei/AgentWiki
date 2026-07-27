import React from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export const LanguageSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { language, toggleLanguage, t } = useLanguage();
  const nextLanguageLabel = language === 'zh-CN' ? t('language.english') : t('language.chinese');

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
      aria-label={t('language.switch')}
      title={t('language.switch')}
    >
      <Languages size={17} aria-hidden="true" />
      <span className={compact ? 'hidden sm:inline' : ''}>{nextLanguageLabel}</span>
    </button>
  );
};
