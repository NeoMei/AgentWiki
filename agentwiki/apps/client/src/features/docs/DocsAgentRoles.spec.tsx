import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { DocsFeatures } from './DocsFeatures';
import { DocsSecurity } from './DocsSecurity';
import { DocsArchitecture } from './DocsArchitecture';

const renderDoc = (component: React.ReactNode) => render(
  <LanguageProvider><MemoryRouter>{component}</MemoryRouter></LanguageProvider>,
);

describe('Agent role documentation', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('teaches role-only Space access in the feature guide', () => {
    renderDoc(<DocsFeatures />);

    expect(screen.getAllByText(/Reader、Editor 或 Publisher/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Publisher 自动发布仍受 Space 发布策略限制/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/为 Agent 成员配置按 Space 的权限范围/);
  });

  it('describes role ceilings and human-only approval in the security guide', () => {
    renderDoc(<DocsSecurity />);

    expect(screen.getByRole('heading', { name: '凭据角色' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Space Agent 角色' })).toBeInTheDocument();
    expect(screen.getByText(/Reader、Editor、Publisher/)).toBeInTheDocument();
    expect(screen.getByText(/Agent 不能执行人工审批或成员管理/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Credential Scope|凭据范围|具体权限范围/);
  });

  it('uses unified roles in the architecture guide', () => {
    renderDoc(<DocsArchitecture />);

    expect(screen.getByText(/凭据角色和 Space Agent 角色/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/凭据范围和空间授权|credential scope and space grants/i);
  });
});
