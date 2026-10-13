import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { IngestRunDetails } from './IngestRunDetails';

describe('IngestRunDetails terminal stages', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

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
