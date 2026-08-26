import { useEffect, useId, useState } from 'react';
import { MAX_MERMAID_SOURCE_CHARS, sanitizeMermaidSvg } from './mermaidSecurity';

type MermaidRuntime = typeof import('mermaid')['default'];

let runtimePromise: Promise<MermaidRuntime> | null = null;
let renderCounter = 0;

export const loadMermaidRuntime = () => {
  runtimePromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
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
      maxTextSize: MAX_MERMAID_SOURCE_CHARS,
      maxEdges: 200,
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    return mermaid;
  });
  return runtimePromise;
};

export type MermaidRuntimeLoader = () => Promise<MermaidRuntime>;

interface MermaidDiagramProps {
  source: string;
  loadingLabel: string;
  errorLabel: string;
  tooLargeLabel: string;
  loadRuntime?: MermaidRuntimeLoader;
}

type RenderState =
  | { source: string; status: 'loading' }
  | { source: string; status: 'ready'; svg: string }
  | { source: string; status: 'error' };

const readableSource = (source: string) => <pre><code>{source}</code></pre>;

export const MermaidDiagram = ({
  source,
  loadingLabel,
  errorLabel,
  tooLargeLabel,
  loadRuntime = loadMermaidRuntime,
}: MermaidDiagramProps) => {
  const reactId = useId();
  const [renderId] = useState(() => {
    const safeReactId = reactId.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'diagram';
    renderCounter += 1;
    return `mermaid-${safeReactId}-${renderCounter}`;
  });
  const [state, setState] = useState<RenderState>({ source, status: 'loading' });
  const isTooLarge = source.length > MAX_MERMAID_SOURCE_CHARS;

  useEffect(() => {
    if (isTooLarge) return undefined;

    let active = true;
    setState({ source, status: 'loading' });

    void (async () => {
      try {
        const mermaid = await loadRuntime();
        if (!active) return;
        const parsed = await mermaid.parse(source);
        if (!active) return;
        if (!parsed) throw new Error('MERMAID_SOURCE_INVALID');
        const { svg } = await mermaid.render(renderId, source);
        if (!active) return;
        const sanitizedSvg = sanitizeMermaidSvg(svg);
        if (active) setState({ source, status: 'ready', svg: sanitizedSvg });
      } catch {
        if (active) setState({ source, status: 'error' });
      }
    })();

    return () => {
      active = false;
    };
  }, [isTooLarge, loadRuntime, renderId, source]);

  if (isTooLarge) {
    return <div data-mermaid-state="error">
      <p role="alert">{tooLargeLabel}</p>
      {readableSource(source)}
    </div>;
  }

  if (state.source !== source || state.status === 'loading') {
    return <div data-mermaid-state="loading">
      <p role="status">{loadingLabel}</p>
      {readableSource(source)}
    </div>;
  }

  if (state.status === 'error') {
    return <div data-mermaid-state="error">
      <p role="alert">{errorLabel}</p>
      {readableSource(source)}
    </div>;
  }

  return <div
    data-mermaid-state="ready"
    dangerouslySetInnerHTML={{ __html: state.svg }}
  />;
};
