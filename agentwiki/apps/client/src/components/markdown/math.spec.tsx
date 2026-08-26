import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Markdown } from '../Markdown';

const renderMd = (content: string) => render(
  <MemoryRouter>
    <Markdown>{content}</Markdown>
  </MemoryRouter>,
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('renders inline and display math with accessible MathML', () => {
  renderMd('Euler: $e^{i\\pi}+1=0$\n\n$$\\int_0^1 x^2 dx$$');

  expect(document.querySelectorAll('.katex')).toHaveLength(2);
  expect(document.querySelector('math')).not.toBeNull();
});

it('renders an invalid formula as local error text without crashing', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  renderMd('before $\\notARealCommand{$ after');

  expect(screen.getByText(/before/)).toBeInTheDocument();
  expect(consoleError).not.toHaveBeenCalled();
});

it('does not trust external-resource or html commands', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  renderMd('$\\includegraphics{https://evil.test/pixel.png}$ $\\htmlClass{x}{bad}$');

  expect(document.querySelector('img[src*="evil.test"]')).toBeNull();
  expect(document.querySelector('.x')).toBeNull();
});

it('still skips raw markdown html', () => {
  renderMd('<img src=x onerror=alert(1)>safe');

  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText('safe')).toBeInTheDocument();
});
