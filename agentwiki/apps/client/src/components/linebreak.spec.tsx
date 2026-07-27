import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('single line break rendering', () => {
  afterEach(cleanup);
  it('renders a single newline as a line break', () => {
    const { container } = render(<MemoryRouter><Markdown pages={[]}>{'line one\nline two'}</Markdown></MemoryRouter>);
    expect(container.querySelector('br')).toBeTruthy();
  });
  it('renders multi-line content across breaks', () => {
    const { container } = render(<MemoryRouter><Markdown pages={[]}>{'a\nb\nc'}</Markdown></MemoryRouter>);
    expect(container.querySelectorAll('br').length).toBeGreaterThanOrEqual(2);
  });
});
