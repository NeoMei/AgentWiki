import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_MERMAID_SOURCE_CHARS } from './mermaidSecurity';
import { loadMermaidRuntime, MermaidDiagram, type MermaidRuntimeLoader } from './MermaidDiagram';

const runtimeModule = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: runtimeModule,
}));

const labels = {
  loadingLabel: '正在渲染图表…',
  errorLabel: '图表无法渲染',
  tooLargeLabel: '图表内容超出限制',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeRuntime = () => ({
  parse: vi.fn().mockResolvedValue(true),
  render: vi.fn().mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>safe diagram</text></svg>',
    bindFunctions: vi.fn(),
  }),
});

const loaderFor = (runtime = makeRuntime()) => ({
  runtime,
  loadRuntime: vi.fn().mockResolvedValue(runtime) as unknown as MermaidRuntimeLoader,
});

describe('loadMermaidRuntime', () => {
  it('caches one dynamic import and initializes Mermaid with the strict reviewed options', async () => {
    const first = loadMermaidRuntime();
    const second = loadMermaidRuntime();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(runtimeModule);
    expect(runtimeModule.initialize).toHaveBeenCalledTimes(1);
    expect(runtimeModule.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'suppressErrorRendering',
        'maxEdges',
        'htmlLabels',
      ],
      maxTextSize: 20_000,
      maxEdges: 200,
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
  });
});

describe('MermaidDiagram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses before rendering, sanitizes the SVG, and never binds Mermaid callbacks', async () => {
    const order: string[] = [];
    const bindFunctions = vi.fn();
    const runtime = {
      parse: vi.fn(async () => {
        order.push('parse');
        return true;
      }),
      render: vi.fn(async () => {
        order.push('render');
        return {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="https://evil.test"><text>unsafe</text></a><text>safe diagram</text></svg>',
          bindFunctions,
        };
      }),
    };
    const loadRuntime = vi.fn().mockResolvedValue(runtime) as unknown as MermaidRuntimeLoader;
    const { container } = render(<MermaidDiagram source="graph TD; A-->B" loadRuntime={loadRuntime} {...labels} />);

    expect(screen.getByRole('status')).toHaveTextContent(labels.loadingLabel);
    expect(screen.getByText('graph TD; A-->B')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[data-mermaid-state="ready"] svg')).not.toBeNull());

    expect(order).toEqual(['parse', 'render']);
    expect(runtime.parse).toHaveBeenCalledWith('graph TD; A-->B');
    expect(container.innerHTML).toContain('safe diagram');
    expect(container.innerHTML).not.toMatch(/script|evil\.test/iu);
    expect(bindFunctions).not.toHaveBeenCalled();
  });

  it.each([
    ['a loader rejection', 'load'],
    ['a parser rejection', 'parse'],
    ['a false parse result', 'false'],
    ['a renderer rejection', 'render'],
    ['a non-SVG renderer result', 'non-svg'],
  ])('keeps readable source after %s', async (_label, failure) => {
    const runtime = makeRuntime();
    const loadRuntime = failure === 'load'
      ? vi.fn().mockRejectedValue(new Error('load failed')) as unknown as MermaidRuntimeLoader
      : loaderFor(runtime).loadRuntime;
    if (failure === 'parse') runtime.parse.mockRejectedValue(new Error('invalid syntax'));
    if (failure === 'false') runtime.parse.mockResolvedValue(false);
    if (failure === 'render') runtime.render.mockRejectedValue(new Error('render failed'));
    if (failure === 'non-svg') runtime.render.mockResolvedValue({ svg: '<div>not svg</div>', bindFunctions: vi.fn() });
    render(<MermaidDiagram source="invalid diagram source" loadRuntime={loadRuntime} {...labels} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(labels.errorLabel);
    expect(screen.getByText('invalid diagram source')).toBeInTheDocument();
  });

  it('rejects over-limit source before invoking the runtime loader', () => {
    const { loadRuntime } = loaderFor();
    const source = 'x'.repeat(MAX_MERMAID_SOURCE_CHARS + 1);

    render(<MermaidDiagram source={source} loadRuntime={loadRuntime} {...labels} />);

    expect(screen.getByRole('alert')).toHaveTextContent(labels.tooLargeLabel);
    expect(screen.getByText(source)).toBeInTheDocument();
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it('accepts source at the exact reviewed limit', async () => {
    const { runtime, loadRuntime } = loaderFor();
    const source = 'x'.repeat(MAX_MERMAID_SOURCE_CHARS);

    render(<MermaidDiagram source={source} loadRuntime={loadRuntime} {...labels} />);

    await waitFor(() => expect(runtime.parse).toHaveBeenCalledWith(source));
    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it('uses unique safe render IDs for two diagrams', async () => {
    const { runtime, loadRuntime } = loaderFor();

    render(<>
      <MermaidDiagram source="graph TD; A-->B" loadRuntime={loadRuntime} {...labels} />
      <MermaidDiagram source="graph TD; C-->D" loadRuntime={loadRuntime} {...labels} />
    </>);

    await waitFor(() => expect(runtime.render).toHaveBeenCalledTimes(2));
    const ids = runtime.render.mock.calls.map(([id]) => id as string);
    expect(new Set(ids)).toHaveLength(2);
    expect(ids).toEqual(ids.map((_id) => expect.stringMatching(/^mermaid-[A-Za-z0-9_-]+$/u)));
  });

  it('ignores a stale render after the source changes', async () => {
    const oldRender = deferred<{ svg: string; bindFunctions: ReturnType<typeof vi.fn> }>();
    const runtime = makeRuntime();
    runtime.render.mockImplementation((_id: string, source: string) => source === 'old source'
      ? oldRender.promise
      : Promise.resolve({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>current result</text></svg>',
        bindFunctions: vi.fn(),
      }));
    const { loadRuntime } = loaderFor(runtime);
    const view = render(<MermaidDiagram source="old source" loadRuntime={loadRuntime} {...labels} />);
    await waitFor(() => expect(runtime.render).toHaveBeenCalledTimes(1));

    view.rerender(<MermaidDiagram source="current source" loadRuntime={loadRuntime} {...labels} />);
    await screen.findByText('current result');
    await act(async () => oldRender.resolve({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>stale result</text></svg>',
      bindFunctions: vi.fn(),
    }));

    expect(screen.getByText('current result')).toBeInTheDocument();
    expect(screen.queryByText('stale result')).not.toBeInTheDocument();
  });

  it('does not publish a pending result after unmount', async () => {
    const pendingRender = deferred<{ svg: string; bindFunctions: ReturnType<typeof vi.fn> }>();
    const runtime = makeRuntime();
    runtime.render.mockReturnValue(pendingRender.promise);
    const { loadRuntime } = loaderFor(runtime);
    const view = render(<MermaidDiagram source="graph TD; A-->B" loadRuntime={loadRuntime} {...labels} />);
    await waitFor(() => expect(runtime.render).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => pendingRender.resolve({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>late result</text></svg>',
      bindFunctions: vi.fn(),
    }));

    expect(document.body).not.toHaveTextContent('late result');
  });
});
