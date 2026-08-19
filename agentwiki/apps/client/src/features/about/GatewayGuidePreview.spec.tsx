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
    expect(screen.getByRole('button', { name: '复制接入指令' })).toBeDisabled();
  });
});
