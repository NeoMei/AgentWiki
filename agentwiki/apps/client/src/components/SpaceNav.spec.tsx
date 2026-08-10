import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SpaceNav } from './SpaceNav';
import { LanguageProvider } from '../context/LanguageContext';

describe('SpaceNav', () => {
  it('keeps all six task-oriented space entries available on a subpage', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1/graph']}><SpaceNav spaceId="space-1" /></MemoryRouter></LanguageProvider>);
    for (const label of ['Pages', 'Graph', 'Sources', 'Runs', 'Members', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute('aria-current', 'page');
  });
});
