import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../context/LanguageContext';
import { ObsidianGuide } from './ObsidianGuide';

describe('ObsidianGuide availability', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('states that community review is pending and gives exact manual files', () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);
    expect(screen.getByText('社区市场审核中')).toBeInTheDocument();
    expect(screen.getByText(/main\.js.*manifest\.json.*styles\.css/)).toBeInTheDocument();
    expect(screen.getByText(/\.obsidian\/plugins\/agentwiki-sync\//)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载最新 Release' })).toHaveAttribute(
      'href', 'https://github.com/NeoMei/agentwiki-sync/releases/latest',
    );
  });
});
