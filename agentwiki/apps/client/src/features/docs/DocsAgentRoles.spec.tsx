import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { DocsFeatures } from './DocsFeatures';
import { DocsSecurity } from './DocsSecurity';
import { DocsArchitecture } from './DocsArchitecture';
import { DocsOverview } from './DocsOverview';

const renderDoc = (component: React.ReactNode, language: 'zh-CN' | 'en' = 'zh-CN') => {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(<LanguageProvider><MemoryRouter>{component}</MemoryRouter></LanguageProvider>);
};

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
    expect(screen.getByText(/接入时.*选择一次/)).toBeInTheDocument();
    expect(screen.getByText(/Agent (?:永远)?不能执行人工审批或成员管理/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Credential Scope|凭据范围|具体权限范围|创建凭据时/);
  });

  it('uses unified roles in the architecture guide', () => {
    renderDoc(<DocsArchitecture />);

    expect(screen.getByText(/凭据角色和 Space Agent 角色/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/凭据范围和空间授权|credential scope and space grants/i);
  });

  it('describes the Chinese review path without claiming every Agent write needs human approval', () => {
    renderDoc(<DocsOverview />);
    renderDoc(<DocsFeatures />);
    renderDoc(<DocsSecurity />);
    const copy = document.body.textContent || '';

    expect(copy).toMatch(/Reader 不可写/);
    expect(copy).toMatch(/Editor.*进入待审核/);
    expect(copy).toMatch(/Publisher 凭据、Publisher Space 授权与 Space 发布策略/);
    expect(copy).toMatch(/Agent 永远不能执行人工审批或成员管理/);
    expect(copy).toMatch(/只撤销该凭据/);
    expect(copy).toMatch(/暂停或撤销 Agent.*全局停止/);
    expect(copy).not.toMatch(/Agent 的每一次写入都经过.*由人类确认后才发布/);
    expect(copy).not.toMatch(/Agent 的写入操作进入.*由人工审批后才发布/);
    expect(copy).not.toMatch(/Agent 的每一次写入.*都不会直接生效/);
    expect(copy).not.toMatch(/吊销后该 Agent 在所有 Space 的访问立即失效/);
  });

  it('describes the English review path and per-Credential revocation accurately', () => {
    renderDoc(<DocsOverview />, 'en');
    renderDoc(<DocsFeatures />, 'en');
    renderDoc(<DocsSecurity />, 'en');
    const copy = document.body.textContent || '';

    expect(copy).toMatch(/Reader cannot write/i);
    expect(copy).toMatch(/Editor.*pending review/i);
    expect(copy).toMatch(/Publisher Credential, Publisher Space Grant, and Space publishing policy/i);
    expect(copy).toMatch(/Agents can never perform human approval or member management/i);
    expect(copy).toMatch(/revokes only that credential/i);
    expect(copy).toMatch(/Pausing or revoking the Agent.*global stop/i);
    expect(copy).not.toMatch(/Every Agent write goes through.*human confirms before it is published/i);
    expect(copy).not.toMatch(/Agent writes enter.*requiring human approval before publishing/i);
    expect(copy).not.toMatch(/Every Agent write.*does not take effect directly/i);
    expect(copy).not.toMatch(/immediately disabling the Agent across all Spaces/i);
  });
});
