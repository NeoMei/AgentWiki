import { cleanup, render, screen } from '@testing-library/react';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { version as katexVersion } from 'katex';
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

it('resolves every math dependency to the reviewed KaTeX runtime', () => {
  const require = createRequire(import.meta.url);
  const directKatex = realpathSync(require.resolve('katex'));
  const rehypeKatex = realpathSync(require.resolve('rehype-katex'));
  const remarkMath = realpathSync(require.resolve('remark-math'));
  const micromarkMath = realpathSync(createRequire(remarkMath).resolve('micromark-extension-math'));
  const resolvedKatexEntries = [
    directKatex,
    realpathSync(createRequire(rehypeKatex).resolve('katex')),
    realpathSync(createRequire(micromarkMath).resolve('katex')),
  ];

  expect(katexVersion).toBe('0.18.4');
  expect(new Set(resolvedKatexEntries)).toEqual(new Set([directKatex]));
});

it('renders fractions, scripts, roots, and matrices with matching layout classes', () => {
  const { container } = renderMd('$$\\frac{x_1^2}{\\sqrt{y}} + \\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$');

  for (const className of ['katex-base', 'katex-strut', 'mfrac', 'msupsub', 'sqrt', 'mtable']) {
    expect(container.querySelector(`.${className}`)).not.toBeNull();
  }
});

it('renders an invalid formula as local error text without crashing', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { container } = renderMd('before $\\notARealCommand{$ after');
  const error = container.querySelector('.katex-error');

  expect(error).not.toBeNull();
  expect(error).toHaveTextContent('\\notARealCommand{');
  expect(container.querySelector('p')).toHaveTextContent('before \\notARealCommand{ after');
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
