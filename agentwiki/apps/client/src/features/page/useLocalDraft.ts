import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraftIfExact, compareDraft, readDraft, saveDraft, type AuthorizedDraftPage, type DraftInput, type LocalDraft } from './localDrafts';

type LocalStatus = 'none' | 'pending' | 'saved' | 'quota-exceeded' | 'unavailable';
export const useLocalDraft = (context: () => AuthorizedDraftPage | null) => {
  const [offer, setOffer] = useState<LocalDraft | null>(null);
  const [status, setStatus] = useState<LocalStatus>('none');
  const pending = useRef<{ remote: AuthorizedDraftPage; input: DraftInput } | null>(null);
  const written = useRef<LocalDraft | null>(null);
  const human = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const flush = useCallback((): LocalDraft | null => {
    cancel();
    const queued = pending.current;
    pending.current = null;
    const live = context();
    if (!queued || !live || !live.canEdit || live.userId !== queued.remote.userId || live.spaceId !== queued.remote.spaceId || live.pageId !== queued.remote.pageId || live.updatedAt !== queued.remote.updatedAt) return null;
    const result = saveDraft(live, queued.input, live);
    if (result.status === 'saved') {
      written.current = result.draft;
      setStatus('saved');
      return result.draft;
    }
    if (result.status === 'unchanged') {
      const previous = written.current;
      if (previous) {
        const clear = clearDraftIfExact(live, previous);
        if (clear.status === 'unavailable') { setStatus('unavailable'); return null; }
        written.current = null;
      }
      setStatus('none');
    } else if (result.status === 'quota-exceeded' || result.status === 'unavailable') setStatus(result.status);
    return null;
  }, [cancel, context]);
  const schedule = useCallback((title: string, content: string) => {
    const live = context();
    if (!live?.canEdit) return;
    human.current = true;
    pending.current = { remote: live, input: { baseUpdatedAt: live.updatedAt, title, content } };
    cancel();
    setStatus(title === live.title && content === live.content ? 'none' : 'pending');
    timer.current = setTimeout(flush, 500);
  }, [cancel, context, flush]);
  const suspend = useCallback(() => {
    cancel(); pending.current = null; written.current = null; human.current = false;
    setOffer(null); setStatus('none');
  }, [cancel]);
  const load = useCallback((remote: AuthorizedDraftPage) => {
    cancel(); pending.current = null; written.current = null; human.current = false; setStatus('none');
    const result = readDraft(remote);
    setOffer(result.status === 'found' && compareDraft(result.draft, remote) !== 'unchanged' ? result.draft : null);
    if (result.status === 'unavailable') setStatus('unavailable');
  }, [cancel]);
  const discard = useCallback(() => {
    const live = context();
    if (!offer || !live?.canEdit || offer.userId !== live.userId || offer.spaceId !== live.spaceId || offer.pageId !== live.pageId) return;
    const result = clearDraftIfExact(live, offer);
    if (result.status === 'unavailable') setStatus('unavailable');
    else { setOffer(null); if (result.status === 'different') load(live); }
  }, [context, load, offer]);
  const recovered = useCallback(() => { setOffer(null); }, []);
  const prepareSave = useCallback((title: string, content: string) => {
    if (!human.current) return null;
    schedule(title, content);
    return flush();
  }, [flush, schedule]);
  const saved = useCallback((submitted: LocalDraft | null, remote: AuthorizedDraftPage, title: string, content: string) => {
    cancel(); pending.current = null;
    const result = submitted ? clearDraftIfExact(remote, submitted) : null;
    setOffer(null);
    if (human.current && (title !== remote.title || content !== remote.content)) {
      schedule(title, content);
      flush();
    } else {
      // Edits may return to submitted bytes while Save is in flight. Remove
      // only this session's last exact record if it now equals the saved page.
      const last = written.current;
      const clearUnchanged = last && last.title === remote.title && last.content === remote.content
        ? clearDraftIfExact(remote, last) : null;
      written.current = null;
      human.current = false;
      setStatus(result?.status === 'unavailable' || clearUnchanged?.status === 'unavailable' ? 'unavailable' : 'none');
    }
  }, [cancel, flush, schedule]);
  useEffect(() => {
    const persist = () => { flush(); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush();
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [flush]);
  return { offer, status, load, schedule, flush, suspend, discard, recovered, saved, prepareSave };
};
