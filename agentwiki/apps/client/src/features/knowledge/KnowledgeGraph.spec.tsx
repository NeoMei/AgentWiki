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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
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

    const { container } = render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <Routes>
            <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText('自动·链接', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('手动')).toBeInTheDocument();

    fireEvent.click(container.querySelector('canvas')!, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(screen.getAllByText('自动·链接')).toHaveLength(2));

    fireEvent.click(screen.getAllByText('自动·链接')[0]);
    await waitFor(() => {
      expect(screen.getByText('自动·链接')).toHaveClass('line-through');
    });
  });

  it('closes the relation dialog with Escape, exits linking mode, and restores focus', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('/knowledge/graph/')) {
        return Promise.resolve({ data: {
          nodes: [node('p1', 'Alpha'), { ...node('p2', 'Beta'), x: 200 }],
          edges: [],
        } });
      }
      return Promise.resolve({ data: { data: [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }] } });
    });

    const { container } = render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/s1/graph']}>
          <Routes>
            <Route path='/spaces/:spaceId/graph' element={<KnowledgeGraph />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    const canvas = await waitFor(() => {
      const value = container.querySelector('canvas');
      expect(value).toBeInTheDocument();
      return value!;
    });
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    const opener = screen.getByRole('button', { name: '建立关系…' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '创建关系' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/正在从以下页面建立关系/)).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
