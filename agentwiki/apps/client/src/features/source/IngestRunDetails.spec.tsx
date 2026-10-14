import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { IngestRunDetails } from './IngestRunDetails';

describe('IngestRunDetails terminal stages', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('shows recorded remote failure stage, reason, advice and safe technical details', () => {
    render(<LanguageProvider><MemoryRouter><IngestRunDetails run={{
      status: 'failed', stage: 'failed', error: 'Bearer private-secret', createdAt: '2026-10-13T10:00:00Z',
      result: { failure: { stage: 'fetching', code: 'REMOTE_CONTENT_TYPE_UNSUPPORTED', token: 'private-secret' },
        sourceMetadata: { finalUrl: 'https://user:pass@example.test/file?token=private-secret', contentType: 'application/pdf', statusCode: 200 } },
    }} /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText(/失败阶段.*抓取/)).toBeVisible();
    expect(screen.getByText(/该地址返回的内容类型不支持/)).toBeVisible();
    expect(screen.getByText(/改用公开的文本/)).toBeVisible();
    expect(screen.getByText('脱敏技术详情')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('REMOTE_CONTENT_TYPE_UNSUPPORTED');
    expect(document.body).not.toHaveTextContent('private-secret');
    expect(document.body).not.toHaveTextContent('user:pass');
  });

  it('explains access-denied HTTP failures without copying the raw exception', () => {
    render(<LanguageProvider><MemoryRouter><IngestRunDetails run={{ status: 'failed', createdAt: '2026-10-13T10:00:00Z',
      error: 'AxiosError token=private-secret', result: { failure: { stage: 'fetching', code: 'REMOTE_REQUEST_FAILED' }, sourceMetadata: { statusCode: 403 } },
    }} /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText(/来源服务器拒绝访问.*403/)).toBeVisible();
    expect(document.body).not.toHaveTextContent('private-secret');
  });

  it('does not invent a historical failure stage when diagnostics were not recorded', () => {
    render(<LanguageProvider><MemoryRouter><IngestRunDetails run={{ status: 'failed', stage: 'fetching', error: 'raw error', createdAt: '2026-10-13T10:00:00Z' }} /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText(/历史记录未保存失败阶段/)).toBeVisible();
  });

  it.each([
    ['stale stage', undefined],
    ['recorded failure stage', { failure: { stage: 'fetching', code: 'GIT_FETCH_FAILED' } }],
  ])('does not describe a failed run as still fetching with %s', (_case, result) => {
    render(<LanguageProvider><MemoryRouter><IngestRunDetails run={{
      id: 'failed-run', status: 'failed', stage: 'fetching', error: 'raw error', result,
      attempts: 1, maxAttempts: 3, createdAt: '2026-10-13T10:00:00.000Z',
    }} /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText('失败', { selector: 'span' })).toBeVisible();
    expect(document.body).not.toHaveTextContent('正在抓取');
    expect(document.body).not.toHaveTextContent('raw error');
    if (result) expect(document.body).toHaveTextContent('Git');
  });
});
