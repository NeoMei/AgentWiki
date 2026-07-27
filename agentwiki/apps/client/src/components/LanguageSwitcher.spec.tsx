import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';

const Example = () => {
  const { t } = useLanguage();
  return <p>{t('nav.spaces')}</p>;
};

describe('LanguageSwitcher', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'en'));

  it('switches visible copy and persists the selected language', () => {
    render(<LanguageProvider><LanguageSwitcher /><Example /></LanguageProvider>);
    expect(screen.getByText('Spaces')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(screen.getByText('知识空间')).toBeInTheDocument();
    expect(localStorage.getItem('agentwiki.language.v1')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
