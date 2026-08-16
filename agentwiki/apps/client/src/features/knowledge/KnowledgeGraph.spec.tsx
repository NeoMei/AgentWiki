import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { KnowledgeGraph } from './KnowledgeGraph';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/client', () => ({ default: api }));

const node = (id: string, title: string) => ({ id, title, x: 100, y: 100, radius: 20 });

describe('KnowledgeGraph origin filters', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.clearAllMocks();
  });

  it('renders origin chips and hides an origin when its chip is toggled off', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('/knowledge/graph/')) {
        return Promise.resolve({ data: {
          nodes: [node('p1', 'Alpha'), node('p2', 'Beta')],
          edges: [
            { id: 'e1', source: 'p1', target: 'p2', relation: 'references', strength: 1, confidence: 1, origin: 'auto_wikilink' },
            { id: 'e2', source: 'p2', target: 'p1', relation: 'related_to', strength: 1, confidence: 1, origin: 'manual' },
          ],
        } });
      }
      return Promise.resolve({ data: { data: [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }] } });
    });

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <Routes>
            <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <KnowledgeGraph />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText('自动·链接', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('手动')).toBeInTheDocument();

    fireEvent.click(screen.getByText('自动·链接'));
    await waitFor(() => {
      expect(screen.getByText('自动·链接')).toHaveClass('line-through');
    });
  });
});
