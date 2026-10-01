import { useEffect, useRef, useState } from 'react';

// Each session has a finite budget. Schedule only after a request settles.
export function useBoundedPolling(key: string | null, enabled: boolean, refresh: () => Promise<boolean | void>, intervalMs = 3000, maxAttempts = 40) {
  const [active, setActive] = useState(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!enabled || !key) { setActive(false); return; }
    let disposed = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    setActive(true);
    const tick = async () => {
      let terminal = false;
      try { terminal = (await refreshRef.current()) === true; }
      catch { terminal = true; } // The caller displays a retryable request error.
      if (disposed) return;
      if (terminal || ++attempts >= maxAttempts) { setActive(false); return; }
      timer = setTimeout(() => void tick(), intervalMs);
    };
    timer = setTimeout(() => void tick(), intervalMs);
    return () => { disposed = true; clearTimeout(timer); };
  }, [key, enabled, intervalMs, maxAttempts]);
  return active;
}

export const isActiveIngestRun = (run: { status?: string }) =>
  ['queued', 'reserved', 'fetching', 'extracting', 'compiling', 'indexing', 'publishing'].includes(run.status || '');
