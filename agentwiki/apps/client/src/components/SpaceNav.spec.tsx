import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SpaceNav } from './SpaceNav';
import { LanguageProvider } from '../context/LanguageContext';

describe('SpaceNav', () => {
  it('keeps Collaboration distinct and between ingest Runs and Members', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/graph']}><SpaceNav spaceId="space-1" /></MemoryRouter></LanguageProvider>);
    for (const label of ['Pages', 'Graph', 'Sources', 'Runs', 'Collaboration', 'Members', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    const labels = screen.getAllByRole('link').map((link) => link.textContent?.trim());
    expect(labels.indexOf('Runs')).toBeLessThan(labels.indexOf('Collaboration'));
    expect(labels.indexOf('Collaboration')).toBeLessThan(labels.indexOf('Members'));
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/spaces/space-1/runs');
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute('aria-current', 'page');
  });
});
