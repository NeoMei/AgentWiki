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
    expect(screen.getByText('版本 0.5.1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在 npm 上查看' })).toHaveAttribute('href', expect.stringContaining('/v/0.5.1'));
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('href', '/guide');
    expect(screen.getByLabelText('Space')).toBeDisabled();
    const role = screen.getByLabelText('Agent 角色');
    expect(role).toBeDisabled();
    expect(Array.from(role.querySelectorAll('option')).map((option) => option.value))
      .toEqual(['reader', 'editor', 'publisher']);
    expect(screen.getByText(/Publisher 自动发布仍受 Space 发布策略限制/)).toBeInTheDocument();
    expect(screen.getByText(/Agent 不能执行人工审批或成员管理/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成统一网关接入指令' })).toBeDisabled();
  });
});
