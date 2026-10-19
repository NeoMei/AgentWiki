import { useEffect, useId, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { Markdown } from '../../components/Markdown';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { getPageTemplate } from './pageTemplateApi';
import { previewCompositeTemplate } from './compositeTemplateApi';
import type { PageTemplateSummary } from './pageTemplateTypes';
import type { CompositeTemplateSummary } from './compositeTemplateTypes';
import './template-content-preview.css';

export type TemplatePreviewSelection =
  | { source: 'legacy'; value: PageTemplateSummary }
  | { source: 'composite'; value: CompositeTemplateSummary };

export interface TemplateContentPreviewProps {
  spaceId: string;
  template: TemplatePreviewSelection;
}

const previewText = {
  'zh-CN': {
    title: '内容预览', expand: '放大预览', close: '关闭预览', page: '预览页面',
    loading: '正在加载模板内容…', failed: '暂时无法加载模板内容', retry: '重试',
    versionChanged: '模板版本已更新，请刷新模板列表后重新选择',
    emptyPage: '此页面尚无正文', emptyGroup: '此模板不包含页面正文', readOnly: '只读预览',
  },
  en: {
    title: 'Content preview', expand: 'Expand preview', close: 'Close preview', page: 'Preview page',
    loading: 'Loading template content…', failed: 'Template content could not be loaded', retry: 'Retry',
    versionChanged: 'This template has been updated. Refresh the template list and select it again.',
    emptyPage: 'This page has no content yet', emptyGroup: 'This template contains no pages', readOnly: 'Read-only preview',
  },
};
interface PreviewPage { id: string; title: string; content: string }
class PreviewVersionChangedError extends Error {}
type PreviewState =
  | { status: 'loading' | 'error' | 'version-changed' }
  | { status: 'ready'; pages: PreviewPage[] };

export function TemplateContentPreview(props: TemplateContentPreviewProps) {
  const { language } = useLanguage();
  const { spaceId, template } = props;
  // Changing the preview identity clears content, page selection and the expanded
  // dialog synchronously, before any response for the new selection can arrive.
  const identity = JSON.stringify([
    spaceId, template.source, template.value.id, template.value.currentVersion,
    template.value.updatedAt, template.value.defaultTitle, language,
  ]);
  return <SelectedTemplatePreview key={identity} {...props} />;
}

function SelectedTemplatePreview({ spaceId, template }: TemplateContentPreviewProps) {
  const { language } = useLanguage();
  const text = previewText[language];
  const id = useId();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pageId, setPageId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { source, value: { id: templateId, currentVersion, defaultTitle } } = template;

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setState({ status: 'loading' });
    const load = async (): Promise<PreviewPage[]> => {
      if (source === 'legacy') {
        const detail = await getPageTemplate(spaceId, templateId, language);
        if (detail.currentVersion !== currentVersion) throw new PreviewVersionChangedError();
        return [{ id: detail.id, title: detail.defaultTitle || detail.name, content: detail.content }];
      }
      const preview = await previewCompositeTemplate(spaceId, templateId, {
        templateVersion: currentVersion,
        locale: language,
        rootName: defaultTitle,
        variables: {},
        collaborationEnabled: false,
      }, controller.signal);
      return preview.nodes.flatMap((node) => node.kind === 'page'
        ? [{ id: node.nodeId, title: node.title, content: node.content }]
        : []);
    };
    void load().then((pages) => {
      if (current) setState({ status: 'ready', pages });
    }).catch((error: unknown) => {
      if (current) setState({ status: error instanceof PreviewVersionChangedError ? 'version-changed' : 'error' });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [spaceId, source, templateId, currentVersion, defaultTitle, language, attempt]);

  const pages = state.status === 'ready' ? state.pages : [];
  const selectedPage = pages.find((page) => page.id === pageId) ?? pages[0];
  const pageSelector = (suffix: string) => pages.length > 1 && (
    <label className="template-content-page-select" htmlFor={`${id}-${suffix}-page`}>
      <span>{text.page}</span>
      <select id={`${id}-${suffix}-page`} value={selectedPage?.id ?? ''}
        onChange={(event) => setPageId(event.target.value)}>
        {pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.title}</option>)}
      </select>
    </label>
  );
  const document = selectedPage && (
    <article className="template-content-document" aria-label={selectedPage.title} key={selectedPage.id}>
      <h3 className="template-content-document-title">{selectedPage.title}</h3>
      {selectedPage.content.trim()
        ? <Markdown mode="static" canEdit={false} spaceId={spaceId}>{selectedPage.content}</Markdown>
        : <p className="template-content-message">{text.emptyPage}</p>}
    </article>
  );

  return <section className="template-content-preview" aria-labelledby={`${id}-heading`}>
    <div className="template-content-preview-heading">
      <h3 id={`${id}-heading`}>{text.title}</h3>
      <button type="button" className="template-content-control" disabled={!selectedPage}
        onClick={() => setExpanded(true)} aria-label={text.expand} title={text.expand}>
        <Maximize2 size={14} aria-hidden="true" /><span>{text.expand}</span>
      </button>
    </div>
    {state.status === 'loading' && <p className="template-content-message" role="status">{text.loading}</p>}
    {state.status === 'version-changed' && <p className="template-content-message" role="alert">{text.versionChanged}</p>}
    {state.status === 'error' && <div className="template-content-message" role="alert">
      <p>{text.failed}</p>
      <button type="button" className="template-content-control template-content-retry" onClick={() => setAttempt((value) => value + 1)}>{text.retry}</button>
    </div>}
    {state.status === 'ready' && (selectedPage
      ? <>{pageSelector('compact')}
        <div className="template-content-thumbnail" tabIndex={expanded ? -1 : 0} role="region" aria-label={text.title}>
          {expanded ? <p className="template-content-message">{text.readOnly}</p> : document}
        </div>
      </>
      : <p className="template-content-message">{text.emptyGroup}</p>)}
    {expanded && selectedPage && <ModalDialog labelledBy={`${id}-dialog-title`} onRequestClose={() => setExpanded(false)}
      className="template-content-modal">
      <header className="template-content-modal-heading">
        <div><h2 id={`${id}-dialog-title`}>{template.value.name} · {text.title}</h2><p>{text.readOnly}</p></div>
        <button type="button" className="template-content-control" aria-label={text.close} title={text.close}
          onClick={() => setExpanded(false)}><X size={20} aria-hidden="true" /></button>
      </header>
      {pageSelector('expanded')}
      <div className="template-content-full" tabIndex={0} role="region" aria-label={text.title}>{document}</div>
    </ModalDialog>}
  </section>;
}
