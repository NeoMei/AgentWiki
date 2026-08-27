import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Markdown } from '../Markdown';
import {
  acquireEmbedCharacters,
  acquireEmbedCount,
  extractMarkdownSection,
  loadTreePage,
  MarkdownRuntimeContext,
  validatorStringLength,
  type ResolvedMarkdownResource,
} from './resources';

interface EmbeddedPageState {
  pageId: string;
  status: 'loading' | 'ready' | 'error';
  source?: string;
}

export interface EmbeddedMarkdownProps {
  literal: string;
  label?: string;
  heading?: string;
  blockId?: string;
  sourceOffset: string;
  resource: Extract<ResolvedMarkdownResource, { status: 'resolved'; kind: 'page' }>;
}

const EmbedFallback = ({ literal, message }: { literal: string; message: string }) => (
  <div role="alert" className="markdown-embed-fallback my-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <span>{message} </span><code>{literal}</code>
  </div>
);

export const EmbeddedMarkdown: React.FC<EmbeddedMarkdownProps> = ({
  literal,
  heading,
  blockId,
  sourceOffset,
  resource,
}) => {
  const runtime = useContext(MarkdownRuntimeContext);
  const { t } = useLanguage();
  if (!runtime) return <EmbedFallback literal={literal} message={t('markdown.embed.unavailable')} />;

  const { tree, branch } = runtime;
  const occurrenceKey = `${branch.instanceId}:${sourceOffset}:${resource.pageId}`;
  const immediateFailure = blockId
    ? 'block'
    : branch.visitedPageIds.has(resource.pageId)
      ? 'cycle'
      : branch.depth >= 3
        ? 'depth'
        : acquireEmbedCount(tree, occurrenceKey)
          ? null
          : 'count';
  const [pageState, setPageState] = useState<EmbeddedPageState>({
    pageId: resource.pageId,
    status: immediateFailure ? 'error' : 'loading',
  });
  const currentState = pageState.pageId === resource.pageId
    ? pageState
    : { pageId: resource.pageId, status: 'loading' as const };

  useEffect(() => {
    if (immediateFailure) return;
    let current = true;
    setPageState({ pageId: resource.pageId, status: 'loading' });
    void loadTreePage(tree, resource.pageId).then((source) => {
      if (current) setPageState({ pageId: resource.pageId, status: 'ready', source });
    }).catch(() => {
      if (current) setPageState({ pageId: resource.pageId, status: 'error' });
    });
    return () => {
      current = false;
    };
  }, [immediateFailure, resource.pageId, tree]);

  const selectedSource = useMemo(() => {
    if (currentState.status !== 'ready' || currentState.source === undefined) return undefined;
    return heading ? extractMarkdownSection(currentState.source, heading) : currentState.source;
  }, [currentState, heading]);

  if (immediateFailure) {
    return <EmbedFallback literal={literal} message={t(`markdown.embed.${immediateFailure}`)} />;
  }
  if (currentState.status === 'loading') {
    return <div role="status" className="markdown-embed-loading my-3 rounded border p-3 text-sm text-gray-500">{t('markdown.embed.loading')}</div>;
  }
  if (currentState.status === 'error') {
    return <EmbedFallback literal={literal} message={t('markdown.embed.loadFailed')} />;
  }
  if (selectedSource === null) {
    return <EmbedFallback literal={literal} message={t('markdown.embed.missingSection')} />;
  }
  if (selectedSource === undefined || !acquireEmbedCharacters(
    tree,
    occurrenceKey,
    validatorStringLength(selectedSource),
  )) {
    return <EmbedFallback literal={literal} message={t('markdown.embed.characters')} />;
  }

  const visitedPageIds = new Set(branch.visitedPageIds);
  visitedPageIds.add(resource.pageId);
  return (
    <div className="markdown-page-embed my-4 min-w-0 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
      {tree.rootMode === 'version' ? (
        <p className="mb-3 text-xs text-amber-700">{t('markdown.embed.currentVersion')}</p>
      ) : null}
      <Markdown
        mode="embed"
        canEdit={false}
        spaceId={tree.spaceId}
        pageId={resource.pageId}
        internalBranch={{
          depth: branch.depth + 1,
          documentId: resource.pageId,
          instanceId: `${branch.instanceId}\u0000${sourceOffset}\u0000${resource.pageId}`,
          visitedPageIds,
        }}
      >
        {selectedSource}
      </Markdown>
    </div>
  );
};
