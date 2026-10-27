import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';

/** Only accept the note library route; never turn a URL query into an open redirect. */
export function safeNotesReturnPath(search: string) {
  const value = new URLSearchParams(search).get('notesReturn');
  if (!value || value.length > 2048 || [...value].some(character => character === '\\' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || !/^\/spaces\/[a-zA-Z0-9_-]+\/notes(?:\?[^#]*)?$/u.test(value)) return null;
  const [path, query] = value.split('?', 2);
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (!['scope', 'author', 'status', 'query'].includes(key)) params.delete(key);
  return path + (params.size ? `?${params}` : '');
}

export function notesReturnSearch(search: string) {
  const value = safeNotesReturnPath(search);
  return value ? `?${new URLSearchParams({ notesReturn: value })}` : '';
}

export function NotesReturnLink() {
  const { search } = useLocation();
  const { language } = useLanguage();
  const value = safeNotesReturnPath(search);
  if (!value) return null;
  return <Link to={value} className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
    {language === 'zh-CN' ? '返回笔记检索' : 'Back to notes'}
  </Link>;
}
