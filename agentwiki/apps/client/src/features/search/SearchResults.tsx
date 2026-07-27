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
  };
  similarity: number;
}

export const SearchResults: React.FC = () => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await api.get('/search', { params: { q: query } });
      setResults(res.data.results || []);
    } catch (err: any) {
      setError(err.response?.data?.message || t('search.failed'));
      setResults([]);
    } finally {
      setLoading(false);
    }
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
          <p className="text-gray-500">{t('search.noResults', { query })}</p>
        </div>
      )}

      <div className="space-y-3">
        {results.map((result) => (
          <div
            key={result.page.id}
            className="flex items-start gap-3 p-4 bg-white rounded-lg shadow-sm hover:shadow-md transition border border-gray-100"
          >
            <FileText size={20} className="text-gray-400 flex-shrink-0 mt-1" />
            <div className="flex-1 min-w-0">
              <Link to={`/pages/${result.page.id}`} className="block">
                <h3 className="font-medium text-blue-600 hover:underline">{result.page.title}</h3>
              </Link>
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
                {result.similarity > 0 && result.similarity < 1 && (
                  <span className="text-xs text-gray-400">{t('search.match', { percent: (result.similarity * 100).toFixed(0) })}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
