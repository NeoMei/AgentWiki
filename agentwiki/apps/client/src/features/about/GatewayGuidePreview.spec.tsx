import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { GatewayGuidePreview } from './GatewayGuidePreview';

describe('GatewayGuidePreview', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('shows the current unified gateway card without credentials', () => {
    render(<LanguageProvider><GatewayGuidePreview /></LanguageProvider>);
    expect(screen.getByTestId('gateway-guide-preview')).toHaveTextContent('AgentWiki 统一网关');
    expect(screen.getByText('@neomei/agentwiki-local-sync')).toBeInTheDocument();
    expect(screen.getByText('版本 0.4.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在 npm 上查看' })).toHaveAttribute('href', expect.stringContaining('/v/0.4.0'));
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('href', '/guide');
    expect(screen.getByText('这只授予限定权限；空间策略仍会生效。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成统一网关接入指令' })).toBeDisabled();
  });
});
