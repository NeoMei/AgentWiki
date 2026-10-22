import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { Search, FileText, ArrowLeft, Folder } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface SearchResult {
  page: {
    id: string;
    title: string;
    slug: string;
    spaceId: string;
    space?: { id: string; name: string };
    content?: string;
    path?: string | null;
  };
  similarity?: number;
  matchType?: 'text' | 'semantic';
}

export const SearchResults: React.FC = () => {
  const { t, language } = useLanguage();
  const zh = language === 'zh-CN';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [resultLimit, setResultLimit] = useState(10);
  const [maxLimit, setMaxLimit] = useState(100);
  const [hasMore, setHasMore] = useState<boolean | null>(null);

  const search = async (searchQuery: string, limit: number, expanding = false) => {
    setLoading(true);
    setError(null);
    setSearched(true);
    if (!expanding) {
      setSubmittedQuery(searchQuery);
      setResults([]);
      setHasMore(null);
    }
    try {
      const res = await api.get('/search', { params: { q: searchQuery, limit } });
      setResults(res.data.results || []);
      setResultLimit(res.data.limit ?? limit);
      setMaxLimit(res.data.maxLimit ?? 100);
      setHasMore(typeof res.data.hasMore === 'boolean' ? res.data.hasMore : null);
    } catch (err: any) {
      setError(err.response?.data?.message || t('search.failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !loading) void search(query.trim(), 10);
  };

  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-4">
        <ArrowLeft size={16} />
        {t('search.back')}
      </Link>
      <h1 className="text-2xl font-bold mb-6">{t('common.search')}</h1>
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Search size={18} />
            {loading ? t('search.searching') : t('common.search')}
          </button>
        </div>
      </form>

      {error && <div className="text-center py-4 text-red-500">{error}</div>}

      {searched && !loading && results.length === 0 && !error && (
        <div className="text-center py-8">
          <FileText size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('search.noResults', { query: submittedQuery })}</p>
        </div>
      )}

      {searched && results.length > 0 ? <div className="mb-4 space-y-1 text-sm text-gray-500">
        <p role="status">{zh ? `已显示第 1–${results.length} 条结果；未统计匹配总数。` : `Showing 1–${results.length} results; total not counted.`}</p>
        {hasMore === false ? <p>{zh ? '本次搜索没有更多结果。' : 'No more results for this search.'}</p>
          : resultLimit >= maxLimit ? <p>{zh ? `最多显示前 ${maxLimit} 条结果，请细化关键词以查找更多页面。` : `Only the first ${maxLimit} results can be shown. Refine your query to find more pages.`}</p>
            : <p>{zh ? `继续加载将扩大搜索范围并重新排序，最多显示 ${maxLimit} 条。` : `Loading more expands and reranks the results, up to ${maxLimit}.`}</p>}
      </div> : null}

      <div className="space-y-3">
        {results.map((result) => (
          <article
            key={result.page.id}
            className="flex items-start gap-3 p-4 bg-white rounded-lg shadow-sm hover:shadow-md transition border border-gray-100"
          >
            <FileText size={20} className="text-gray-400 flex-shrink-0 mt-1" />
            <div className="flex-1 min-w-0">
              <Link to={`/pages/${result.page.id}`} className="block">
                <h3 className="font-medium text-blue-600 hover:underline">{result.page.title}</h3>
              </Link>
              <p className="mt-1 break-all text-sm text-gray-500">
                {result.page.path || (zh ? `路径未记录 · ID: ${result.page.id}` : `Path not recorded · ID: ${result.page.id}`)}
              </p>
              {result.page.content && (
                <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                  {result.page.content.substring(0, 150)}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1">
                {result.page.space && (
                  <Link
                    to={`/spaces/${result.page.spaceId}`}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600"
                  >
                    <Folder size={12} />
                    {result.page.space.name}
                  </Link>
                )}
                {result.matchType === 'text' ? <span className="text-xs text-gray-400">{t('search.textMatch')}</span> : null}
                {result.matchType === 'semantic' && typeof result.similarity === 'number' && Number.isFinite(result.similarity) && result.similarity >= 0 && result.similarity <= 1 && (
                  <span className="text-xs text-gray-400">{t('search.semanticRelevance', { percent: (result.similarity * 100).toFixed(0) })}</span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {results.length > 0 && hasMore !== false && resultLimit < maxLimit ? <button
        type="button"
        disabled={loading}
        onClick={() => void search(submittedQuery, Math.min(resultLimit + 10, maxLimit), true)}
        className="mt-4 h-8 rounded-lg border px-3 text-sm disabled:opacity-50"
      >{loading ? t('common.loading') : zh ? '继续加载结果' : 'Load more results'}</button> : null}
    </div>
  );
};
