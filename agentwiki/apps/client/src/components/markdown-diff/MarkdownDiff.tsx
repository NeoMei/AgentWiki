import { useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { diffLines } from './lineDiff';

export function MarkdownDiff({ before, after }: { before: string; after: string }) {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  const labels = { added: zh ? '新增' : 'Added', removed: zh ? '删除' : 'Removed', unchanged: zh ? '未改动' : 'Unchanged' };
  return <div aria-label={zh ? 'Markdown 差异' : 'Markdown diff'}>
    {diff.truncated ? <p role="status" className="mb-2 text-xs text-amber-800">{zh ? '文档较长，差异预览仅显示前 300 行 / 100,000 字符。请下载完整原文与候选检查后再接受。' : 'Long document: diff preview shows only the first 300 lines / 100,000 characters. Download both full texts to review before accepting.'}</p> : null}
    <ol className="max-h-64 overflow-auto rounded border border-gray-200 text-xs">
      {diff.lines.map((line, index) => <li key={index} className={`flex gap-2 whitespace-pre-wrap break-words px-2 py-0.5 ${line.kind === 'added' ? 'bg-green-50 text-green-900' : line.kind === 'removed' ? 'bg-red-50 text-red-900' : 'text-gray-600'}`}>
        <span className="shrink-0 text-[10px]">{labels[line.kind]}</span><code className="min-w-0">{line.text || '\u00a0'}</code>
      </li>)}
    </ol>
  </div>;
}
