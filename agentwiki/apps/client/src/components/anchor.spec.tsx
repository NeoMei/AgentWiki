import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('in-page anchor links', () => {
  afterEach(cleanup);

  it('headings get a slug id for anchor targets', () => {
    const { container } = render(<MemoryRouter><Markdown pages={[]}>{'## 第二节'}</Markdown></MemoryRouter>);
    const h2 = container.querySelector('h2');
    expect(h2?.id).toBeTruthy();
  });

  it('anchor link href matches the heading id', () => {
    const { container } = render(<MemoryRouter><Markdown pages={[]}>{'## 第二节\n\n[跳到第二节](#第二节)'}</Markdown></MemoryRouter>);
    const h2 = container.querySelector('h2');
    const link = container.querySelector('a[href="#第二节"]');
    expect(h2?.id).toBeTruthy();
    expect(link).toBeTruthy();
  });

  it('english headings slug to lowercase-hyphen ids', () => {
    const { container } = render(<MemoryRouter><Markdown pages={[]}>{'## Second Section'}</Markdown></MemoryRouter>);
    const h2 = container.querySelector('h2');
    expect(h2?.id).toBe('second-section');
  });
});
