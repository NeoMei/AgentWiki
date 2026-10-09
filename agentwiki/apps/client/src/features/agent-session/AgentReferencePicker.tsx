import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import type { AgentReference } from './agentSessionTypes';
/** Read-authorized search; no editor-capability impersonation and no cross-Space cache. */
export function AgentReferencePicker({ userId, spaceId, selected, onChange, disabled }: { userId: string; spaceId: string; selected: AgentReference[]; onChange: (items: AgentReference[]) => void; disabled?: boolean }) {
  const { language } = useLanguage(), zh = language === 'zh-CN';
  const [query, setQuery] = useState(''), [results, setResults] = useState<AgentReference[]>([]), [error, setError] = useState(false);
  useEffect(() => {
    setResults([]); setError(false);
    if (!query.trim() || !userId || !spaceId) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api.get('/search', { params: { q: query.trim(), spaceId, limit: 20 }, signal: abort.signal }).then(({ data }) => {
        if (abort.signal.aborted) return;
        const rows = Array.isArray(data?.results) ? data.results : [];
        const unique = new Map<string, AgentReference>();
        for (const row of rows) {
          const page = row.page;
          if (page?.spaceId === spaceId && typeof page.id === 'string' && typeof page.title === 'string') unique.set(page.id, { pageId: page.id, title: page.title });
        }
        setResults([...unique.values()]);
      }).catch(() => { if (!abort.signal.aborted) setError(true); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, userId, spaceId]);
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">{selected.map((reference) => <button type="button" key={reference.pageId} disabled={disabled} className="max-w-full rounded-lg border border-gray-200 px-2 py-1 text-left text-xs [overflow-wrap:anywhere]" aria-label={`${zh ? '移除' : 'Remove'} ${reference.title}`} onClick={() => onChange(selected.filter((r) => r.pageId !== reference.pageId))}>{reference.title} ×</button>)}</div>
    <label className="block text-xs text-gray-600">{zh ? '引用文档（最多 5 篇）' : 'Reference pages (up to 5)'}<input aria-label={zh ? '查找引用文档' : 'Find reference pages'} value={query} disabled={disabled || selected.length >= 5} onChange={(e) => setQuery(e.target.value)} className="mt-1 min-h-8 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label>
    {error ? <p role="alert" className="text-xs text-red-700">{zh ? '无法查找引用，请重新输入重试。' : 'Could not find references. Edit the search to retry.'}</p> : null}
    {results.filter((r) => !selected.some((s) => s.pageId === r.pageId)).length ? <ul className="max-h-32 overflow-auto rounded-lg border border-gray-200">{results.filter((r) => !selected.some((s) => s.pageId === r.pageId)).map((r) => <li key={r.pageId}><button type="button" disabled={disabled || selected.length >= 5} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 [overflow-wrap:anywhere]" aria-label={`${zh ? '添加' : 'Add'} ${r.title}`} onClick={() => { onChange([...selected, r]); setQuery(''); }}>{r.title}</button></li>)}</ul> : null}
  </div>;
}
