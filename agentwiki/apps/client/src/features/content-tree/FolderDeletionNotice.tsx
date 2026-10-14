import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { bugEditorMessages } from '../../i18n/bug-editor-messages';

/** The success notice expires; the recoverable deletion receipt stays available. */
export function FolderDeletionNotice({ name, restoring, onRestore, onDismiss }: { name: string; restoring: boolean; onRestore: () => void; onDismiss: () => void }) {
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(true);
  const [hovering, setHovering] = useState(false), [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!expanded || restoring || hovering || focused) return;
    const timer = window.setTimeout(() => setExpanded(false), 10000);
    return () => window.clearTimeout(timer);
  }, [expanded, restoring, hovering, focused]);
  return <div
    data-testid={expanded ? 'folder-restored-banner' : 'folder-restore-recovery'}
    className={expanded ? 'mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700' : 'fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border border-green-200 bg-white p-2 text-xs text-green-700 shadow-sm'}
    onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
    onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
  >
    {expanded ? <span role="status" className="min-w-0 flex-1 break-all">{t('folder.deletedBanner', { name })}</span> : null}
    <button type="button" onClick={onRestore} disabled={restoring} data-testid="folder-restore-button" title={name}
      className="inline-flex min-w-0 items-center gap-1 rounded border border-green-300 px-2 py-1 font-medium hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50">
      <RotateCcw size={13} className="shrink-0" /><span className="min-w-0 break-words">{expanded ? t('folder.restore') : bugEditorMessages[language === 'zh-CN' ? 'zh-CN' : 'en']['folder.restoreRecent']}</span>
    </button>
    <button type="button" disabled={restoring} aria-label={t('common.close')} onClick={() => expanded ? setExpanded(false) : onDismiss()} className="shrink-0 rounded p-1 hover:bg-green-100"><X size={14} /></button>
  </div>;
}
