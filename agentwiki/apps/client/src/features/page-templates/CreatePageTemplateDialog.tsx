import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../../api/error-message';
import { ModalDialog } from '../../components/ModalDialog';
import { useTemplateEntryLanguage as useLanguage } from './useTemplateEntryLanguage';
import { listPageTemplateSourcePages } from './pageTemplateApi';
import type { PageTemplateDetail, PageTemplateSourcePage, PageTemplateSourcePageListResponse } from './pageTemplateTypes';
import { SavePageAsTemplateDialog } from './SavePageAsTemplateDialog';
import { sourceSelectionText } from './sourceSelectionText';

const PAGE_SIZE = 100;

interface CreatePageTemplateDialogProps {
  spaceId: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onSaved: (template: PageTemplateDetail) => void;
}

/** Uses the same saved-page snapshot and optimistic timestamp as the page editor's Save as template action. */
export function CreatePageTemplateDialog({ spaceId, returnFocusTo, onClose, onSaved }: CreatePageTemplateDialogProps) {
  const { language, t: sharedT } = useLanguage();
  const t = useCallback((key: string, params?: Record<string, string | number>) =>
    sourceSelectionText(language, key, params) ?? sharedT(key, params), [language, sharedT]);
  const [search, setSearch] = useState('');
  const [skip, setSkip] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [catalog, setCatalog] = useState<{ identity: string; value: PageTemplateSourcePageListResponse } | null>(null);
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [source, setSource] = useState<PageTemplateSourcePage | null>(null);
  const advancingRef = useRef(false);
  const resolveReturnFocus = useCallback(() => advancingRef.current
    ? document.getElementById('page-template-name') : returnFocusTo ?? null, [returnFocusTo]);
  const identity = JSON.stringify([spaceId, language, search, skip, retryKey]);
  const current = catalog?.identity === identity ? catalog.value : null;
  const error = failure?.identity === identity ? failure.message : null;
  const loading = !current && !error;
  const selected = current?.data.find((page) => page.id === selectedId);

  useEffect(() => {
    let active = true;
    setSelectedId('');
    void listPageTemplateSourcePages(spaceId, { skip, take: PAGE_SIZE, ...(search.trim() ? { q: search.trim() } : {}) })
      .then((value) => { if (active) setCatalog({ identity, value }); })
      .catch((caught) => { if (active) setFailure({ identity, message: apiErrorMessage(caught, t, 'pageTemplate.sourcePagesLoadFailed') }); });
    return () => { active = false; };
  }, [identity, search, skip, spaceId, t]);

  if (source) return <SavePageAsTemplateDialog
    spaceId={spaceId} pageId={source.id} pageTitle={source.title} pageUpdatedAt={source.updatedAt}
    returnFocusTo={returnFocusTo} onClose={onClose} onSaved={onSaved} />;

  return <ModalDialog labelledBy="create-page-template-title" onRequestClose={onClose} returnFocusTo={returnFocusTo} resolveReturnFocus={resolveReturnFocus}
    className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[14px] bg-white p-4 sm:p-6">
    <h2 id="create-page-template-title" className="text-xl font-semibold">{t('pageTemplate.createFromPage')}</h2>
    <p className="mt-2 text-sm text-gray-500">{t('pageTemplate.createFromPageDescription')}</p>
    <label className="mt-4 block text-sm font-medium">
      <span>{t('pageTemplate.sourcePageSearch')}</span>
      <input data-modal-autofocus type="search" className="mt-2 h-10 w-full rounded-lg border px-3 font-normal"
        value={search} onChange={(event) => { setSearch(event.target.value); setSkip(0); }} />
    </label>
    <div role="status" className="mt-3 text-sm text-gray-500">
      {loading ? t('common.loading') : current ? t('pageTemplate.sourceMatches', { count: current.total }) : null}
    </div>
    {error ? <div className="mt-3 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-red-600">{error}</p>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setRetryKey((value) => value + 1)}>{t('pageTemplate.retry')}</button></div> : null}
    {current ? <div aria-label={t('pageTemplate.chooseSourcePage')} className="mt-3 max-h-72 space-y-2 overflow-y-auto">
      {current.data.length ? current.data.map((page) => <button key={page.id} type="button" aria-pressed={selectedId === page.id}
        onClick={() => setSelectedId(page.id)}
        className={`block w-full rounded-lg border px-3 py-2 text-left text-sm [overflow-wrap:anywhere] ${selectedId === page.id ? 'border-gray-500 bg-gray-100' : 'border-gray-200 hover:bg-gray-50'}`}>
        <span className="block font-medium">{page.title}</span>
        <span className="mt-1 block text-gray-500">{page.path || page.folderId || page.id} · {new Date(page.updatedAt).toLocaleDateString(language)}</span>
      </button>) : <p className="py-4 text-sm text-gray-500">{t('pageTemplate.sourceNoMatches')}</p>}
    </div> : null}
    {current && current.total > PAGE_SIZE ? <div className="mt-3 flex justify-between gap-2">
      <button type="button" disabled={skip === 0} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>{t('common.prev')}</button>
      <button type="button" disabled={skip + current.data.length >= current.total} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => setSkip(skip + PAGE_SIZE)}>{t('common.next')}</button>
    </div> : null}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={onClose}>{t('common.cancel')}</button>
      <button type="button" disabled={!selected} className="rounded-lg bg-[#d41616] px-3 py-2 text-sm text-white disabled:opacity-50"
        onClick={() => { if (selected) { advancingRef.current = true; setSource(selected); } }}>{t('pageTemplate.saveAs')}</button>
    </div>
  </ModalDialog>;
}
