import { useId, useRef } from 'react';
import { Bot, Info, List, MessageSquare, PanelRightClose } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export type DocumentPanelTab = 'contents' | 'info' | 'assist' | 'notes';

interface DocumentPanelToolbarProps {
  activeTab: DocumentPanelTab;
  open: boolean;
  onSelect: (tab: DocumentPanelTab) => void;
  onClose: () => void;
  disabledTabs?: readonly DocumentPanelTab[];
  panelIdPrefix?: string;
}

/** One compact switcher for the document's existing side-panel tools. */
export function DocumentPanelToolbar({ activeTab, open, onSelect, onClose, disabledTabs = [], panelIdPrefix }: DocumentPanelToolbarProps) {
  const { language } = useLanguage();
  const generatedId = useId();
  const prefix = panelIdPrefix ?? generatedId;
  const zh = language === 'zh-CN';
  const buttons = useRef(new Map<DocumentPanelTab, HTMLButtonElement>());
  const tabs = [
    { id: 'contents' as const, label: zh ? '目录' : 'Contents', icon: List },
    { id: 'info' as const, label: zh ? '页面信息' : 'Page information', icon: Info },
    { id: 'assist' as const, label: 'Agent', icon: Bot },
    { id: 'notes' as const, label: zh ? '页面笔记' : 'Page notes', icon: MessageSquare },
  ];
  const enabledTabs = tabs.filter((tab) => !disabledTabs.includes(tab.id));
  const focusTab = enabledTabs.some((tab) => tab.id === activeTab) ? activeTab : enabledTabs[0]?.id;
  return <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-t-xl border-b border-gray-200 bg-white px-3 py-2">
    <div role="tablist" aria-label={zh ? '页面工具' : 'Document tools'} className="flex min-w-0 flex-1 items-center gap-1">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} ref={(button) => { if (button) buttons.current.set(id, button); else buttons.current.delete(id); }}
        type="button" role="tab" id={`${prefix}-tab-${id}`} aria-controls={`${prefix}-panel-${id}`} data-testid={`document-panel-tab-${id}`} data-panel-tab={id} aria-label={label} title={label} disabled={disabledTabs.includes(id)} aria-selected={open && activeTab === id} tabIndex={focusTab === id ? 0 : -1}
        className={`inline-flex h-9 min-w-9 flex-1 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-30 ${open && activeTab === id ? 'bg-gray-100 text-gray-900 shadow-sm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        onClick={() => onSelect(id)} onKeyDown={(event) => {
          const index = enabledTabs.findIndex((tab) => tab.id === id);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabledTabs.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % enabledTabs.length : event.key === 'ArrowLeft' ? (index + enabledTabs.length - 1) % enabledTabs.length : null;
          if (next === null || !enabledTabs[next]) return;
          event.preventDefault();
          buttons.current.get(enabledTabs[next].id)?.focus();
          onSelect(enabledTabs[next].id);
        }}><Icon size={18} aria-hidden="true" /></button>)}
    </div>
    <button type="button" aria-label={zh ? '收起右侧面板' : 'Collapse side panel'} title={zh ? '收起右侧面板' : 'Collapse side panel'} disabled={!open} onClick={onClose}
      className="inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border-l border-gray-100 text-gray-400 hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-30">
      <PanelRightClose size={17} aria-hidden="true" />
    </button>
  </div>;
}
