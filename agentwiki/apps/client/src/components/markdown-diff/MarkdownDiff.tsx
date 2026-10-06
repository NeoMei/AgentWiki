import { Fragment, useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { diffLines } from './lineDiff';

export function MarkdownDiffPreviewWarning({ truncated }: { truncated: boolean }) {
  const { language } = useLanguage();
  return truncated ? <p role="status" className="mb-2 text-xs text-amber-800">{language === 'zh-CN' ? '文档较长，差异预览仅显示前 300 行 / 100,000 字符。请下载完整原文与候选检查后再接受。' : 'Long document: diff preview shows only the first 300 lines / 100,000 characters. Download both full texts to review before accepting.'}</p> : null;
}

export function MarkdownDiff({ before, after, showWarning = true }: { before: string; after: string; showWarning?: boolean }) {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  const [view, setView] = useState({ diff, full: false, expanded: [] as number[] });
  // Compare the memoized input snapshot so a new source never inherits presentation state.
  const current = view.diff === diff ? view : { diff, full: false, expanded: [] as number[] };
  const added = diff.lines.filter((line) => line.kind === 'added').length;
  const removed = diff.lines.filter((line) => line.kind === 'removed').length;
  const gaps = useMemo(() => {
    const result = new Map<number, number>();
    for (let start = 0; start < diff.lines.length;) {
      if (diff.lines[start].kind !== 'unchanged') { start += 1; continue; }
      let end = start;
      while (end < diff.lines.length && diff.lines[end].kind === 'unchanged') end += 1;
      const from = start + (start > 0 ? 3 : 0), to = end - (end < diff.lines.length ? 3 : 0);
      if (to > from) result.set(from, to);
      start = end;
    }
    return result;
  }, [diff]);
  const labels = { added: zh ? '新增' : 'Added', removed: zh ? '删除' : 'Removed', unchanged: zh ? '未改动' : 'Unchanged' };
  const row = (index: number) => {
    const line = diff.lines[index];
    return <li key={index} className={`flex gap-2 whitespace-pre-wrap break-words px-2 py-0.5 ${line.kind === 'added' ? 'bg-green-50 text-green-900' : line.kind === 'removed' ? 'bg-red-50 text-red-900' : 'text-gray-600'}`}>
      <span className="shrink-0 text-[10px]">{labels[line.kind]}</span><code className="min-w-0">{line.text || '\u00a0'}</code>
    </li>;
  };
  const rows = [];
  for (let index = 0; index < diff.lines.length; index += 1) {
    const end = !current.full && gaps.get(index);
    if (!end) { rows.push(row(index)); continue; }
    const expanded = current.expanded.includes(index), start = index;
    rows.push(<Fragment key={`gap-${start}`}>
      <li><button type="button" aria-expanded={expanded} className="w-full bg-gray-50 px-2 py-1 text-left text-gray-600" onClick={() => setView({ ...current, expanded: expanded ? current.expanded.filter((id) => id !== start) : [...current.expanded, start] })}>
        {zh ? `${expanded ? '收起' : '展开'} ${end - start} 行未改动内容` : `${expanded ? 'Hide' : 'Show'} ${end - start} unchanged lines`}
      </button></li>
      {expanded ? diff.lines.slice(start, end).map((_, offset) => row(start + offset)) : null}
    </Fragment>);
    index = end - 1;
  }
  return <div aria-label={zh ? 'Markdown 差异' : 'Markdown diff'}>
    {showWarning ? <MarkdownDiffPreviewWarning truncated={diff.truncated} /> : null}
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
      <span>{zh ? `${diff.truncated ? '预览：' : ''}新增 ${added} 行，删除 ${removed} 行` : `${diff.truncated ? 'Preview: ' : ''}${added} added lines, ${removed} removed lines`}</span>
      {gaps.size ? <button type="button" aria-pressed={current.full} className="rounded border border-gray-200 px-2 py-1" onClick={() => setView({ ...current, full: !current.full })}>{zh ? (current.full ? '聚焦变更' : '显示完整预览') : (current.full ? 'Focus on changes' : 'Show full preview')}</button> : null}
    </div>
    {!added && !removed ? <p className="mb-1 text-xs text-gray-600">{zh ? (diff.truncated ? '显示范围内没有变更。' : '没有变更。') : (diff.truncated ? 'No changes in the displayed portion.' : 'No changes.')}</p> : null}
    <ol className="max-h-64 overflow-auto rounded border border-gray-200 text-xs">
      {rows}
    </ol>
  </div>;
}
