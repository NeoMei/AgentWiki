import { useEffect, useState, type RefObject } from 'react';
import { MessageSquare } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { noteHighlightAttributes, type NoteHighlightSegment } from './noteHighlights';

interface MarginLine { top: number; ids: string[] }
/** Geometry only: source marks retain their own single Text children and exact offsets. */
export function NoteMargin({ root, segments, source, activeNoteId, onActivate }: {
  root: RefObject<HTMLDivElement>;
  segments: readonly NoteHighlightSegment[];
  source: string;
  activeNoteId?: string | null;
  onActivate: (ids: readonly string[]) => void;
}) {
  const [lines, setLines] = useState<MarginLine[]>([]);
  const { language } = useLanguage();
  useEffect(() => {
    const article = root.current;
    if (!article || !segments.length) { setLines([]); return; }
    const measure = () => {
      const articleRect = article.getBoundingClientRect();
      const lastLine = new Map<string, number>();
      for (const mark of article.querySelectorAll<HTMLElement>('.personal-note-highlight[data-note-ids]')) {
        if (mark.closest('[data-markdown-selection-root]') !== article) continue;
        const rects = Array.from(mark.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
        const rect = rects[rects.length - 1];
        if (!rect) continue; // A closed disclosure or hidden layout has no visible source line.
        const top = Math.max(0, rect.top - articleRect.top + (rect.height - 22) / 2);
        for (const id of JSON.parse(mark.dataset.noteIds!) as string[]) lastLine.set(id, top);
      }
      const grouped: MarginLine[] = [];
      for (const [id, top] of [...lastLine].sort((a, b) => a[1] - b[1])) {
        const previous = grouped[grouped.length - 1];
        if (previous && Math.abs(previous.top - top) < 7) previous.ids.push(id);
        else grouped.push({ top, ids: [id] });
      }
      for (const line of grouped) line.ids.sort();
      setLines((previous) => JSON.stringify(previous) === JSON.stringify(grouped) ? previous : grouped);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(article);
    window.addEventListener('resize', measure);
    article.addEventListener('load', measure, true);
    article.addEventListener('toggle', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      article.removeEventListener('load', measure, true);
      article.removeEventListener('toggle', measure, true);
    };
  }, [root, segments, source]);
  return <div className="personal-note-margin" data-markdown-note-margin="true">
    {lines.map(({ top, ids }) => {
      const attributes = noteHighlightAttributes(ids, activeNoteId, language === 'zh-CN');
      return <button key={ids.join('\u0000')} type="button" className={`personal-note-marker${activeNoteId && ids.includes(activeNoteId) ? ' personal-note-marker-active' : ''}`}
        style={{ top }} data-note-marker="true" data-note-ids={JSON.stringify(ids)} data-note-count={ids.length > 1 ? ids.length : undefined}
        title={attributes.title} aria-label={attributes.title} onClick={() => onActivate(ids)}>
        <MessageSquare size={14} aria-hidden="true" />
      </button>;
    })}
  </div>;
}
