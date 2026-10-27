import { useEffect, useRef, useState } from 'react';
import { notesDiscoveryApi, type NotesSearchInput, type NotesSearchResult } from './notesDiscoveryApi';

interface SearchState extends NotesSearchResult { key: string; loading: boolean; loaded: boolean; error: boolean; pagesLoaded: number }
const blank = (key: string): SearchState => ({ key, notes: [], total: 0, nextCursor: null, loading: false, loaded: false, error: false, pagesLoaded: 0 });
/** A read-only collection. Its identity barrier never feeds another page's mutation queue. */
export function useNotesDiscovery(identity: string, input: Omit<NotesSearchInput, 'cursor' | 'limit'>, enabled: boolean) {
  const key = JSON.stringify([identity, input.spaceId, input.query, input.author, input.status, enabled]);
  const currentKey = useRef(key); currentKey.current = key;
  const [state, setState] = useState<SearchState>(() => blank(key));
  const stateRef = useRef(state); stateRef.current = state;
  const generation = useRef(0), pending = useRef(false), controller = useRef<AbortController | null>(null);
  const load = async (append: boolean) => {
    if (!enabled || currentKey.current !== key || pending.current) return;
    const previous = stateRef.current.key === key ? stateRef.current : blank(key);
    if (append && !previous.nextCursor) return;
    const cursor = append ? previous.nextCursor! : undefined;
    let safePrevious = previous;
    const epoch = generation.current;
    pending.current = true;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setState({ ...(append ? previous : blank(key)), loading: true, error: false });
    try {
      let result = await notesDiscoveryApi.list({ ...input, cursor }, request.signal);
      if (request.signal.aborted || generation.current !== epoch || currentKey.current !== key) return;
      let appendResults = append;
      const accessChanged = !!previous.accessRevision && !!result.accessRevision && previous.accessRevision !== result.accessRevision;
      if (append && (result.total < previous.total || accessChanged)) {
        // A changed access set or smaller page can signal revoked access or deletion.
        // Drop earlier cards before re-reading; never revive them if that read fails.
        safePrevious = blank(key); appendResults = false;
        setState({ ...safePrevious, loading: true });
        if (result.total > 0) {
          result = await notesDiscoveryApi.list({ ...input, cursor: undefined }, request.signal);
          if (request.signal.aborted || generation.current !== epoch || currentKey.current !== key) return;
        }
      }
      const notes = appendResults ? [...previous.notes, ...result.notes.filter(note => !previous.notes.some(existing => existing.id === note.id))] : result.notes;
      setState({ ...result, notes, key, loading: false, loaded: true, error: false, pagesLoaded: appendResults ? previous.pagesLoaded + 1 : 1 });
    } catch (error) {
      if (!request.signal.aborted && generation.current === epoch && currentKey.current === key) {
        const denied = [401, 403, 404].includes((error as { response?: { status?: number } })?.response?.status ?? 0);
        setState({ ...(denied ? blank(key) : safePrevious), key, loading: false, loaded: true, error: true });
      }
    } finally {
      if (generation.current === epoch && currentKey.current === key) pending.current = false;
    }
  };
  useEffect(() => {
    generation.current++; pending.current = false;
    if (enabled) void load(false); else setState(blank(key));
    return () => { generation.current++; pending.current = false; controller.current?.abort(); };
    // The serialized key contains every request input and the authenticated identity.
  }, [key]);
  const visible = state.key === key && enabled ? state : blank(key);
  return { ...visible, loadMore: () => load(true), retry: () => load(visible.notes.length > 0 && !!visible.nextCursor) };
}
