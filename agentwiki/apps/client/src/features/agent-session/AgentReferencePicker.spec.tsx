import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentReferencePicker } from './AgentReferencePicker';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it.each([
  ['zh-CN', '查找引用文档', '请输入需要引用的文档名称'],
  ['en', 'Find reference pages', 'Enter the name of the document to reference'],
] as const)('guides reference search with a localized placeholder in %s', (language, label, placeholder) => {
  localStorage.setItem('agentwiki.language.v1', language);
  render(
    <LanguageProvider>
      <AgentReferencePicker userId="user-a" spaceId="space-a" selected={[]} onChange={vi.fn()} />
    </LanguageProvider>,
  );

  expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('placeholder', placeholder);
});
