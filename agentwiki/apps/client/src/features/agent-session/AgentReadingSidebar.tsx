import { useLanguage } from '../../context/LanguageContext';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import type { usePersonalNotes } from '../page/usePersonalNotes';
import { PersonalNotesPanel } from '../page/PersonalNotesPanel';
import type { AssistTarget } from '../page/assistTargets';
import { AgentSessionPanel } from './AgentSessionPanel';
import type { AgentSessionPanelProps } from './agentSessionTypes';
export function AgentReadingSidebar({ page, notes, activeNoteId, onLocateNote, onClearActiveNote, onDocumentWritten, visible = true, notesOpen, notesContainer, agentContainer, focusRequest, target, onOpenAgent }: {
  page: { id: string; spaceId: string; title: string; content: string; updatedAt: string; capabilities?: { canEdit?: boolean } };
  visible?: boolean; notesOpen: boolean; target: AssistTarget | null; onOpenAgent: () => void;
  notesContainer: HTMLElement | null; agentContainer: HTMLElement | null; focusRequest?: string;
  notes: ReturnType<typeof usePersonalNotes>; activeNoteId: string | null; onLocateNote: (id: string) => boolean; onClearActiveNote: () => void;
  onDocumentWritten?: AgentSessionPanelProps['onDocumentWritten'];
}) {
  const { user } = useAuth(), { language } = useLanguage(), zh = language === 'zh-CN';
  return <>
    {notesContainer ? createPortal(<div className="min-h-0 flex-1 overflow-auto p-3">
      {!notes.loaded ? <p role="status" className="mb-2 text-sm text-gray-500">{zh ? '正在加载页面笔记…' : 'Loading page notes…'}</p> : null}
      {notes.conflict ? <p role="alert">{zh ? '选文已变化或笔记超过长度限制，请检查后重试。' : 'The passage changed or notes exceed the limit. Check and retry.'}</p> : null}
      <PersonalNotesPanel stageForSession identityKey={notes.identityKey} syncing={notes.syncing} onRetrySync={notes.retrySync} source={page.content} notes={notes.notes} activeNoteId={visible && notesOpen ? activeNoteId : null} onLocate={onLocateNote} onClearActive={onClearActiveNote} disabled={!user?.id || !notes.loaded || !!notes.assistRequest} storageUnavailable={notes.storageUnavailable} onResolve={notes.resolve} onReopen={notes.reopen} onDispatch={(ids) => { if (notes.dispatch(ids)) onOpenAgent(); }} />
    </div>, notesContainer) : null}
    {agentContainer ? createPortal(<div className="flex min-h-0 flex-1 flex-col">
      <AgentSessionPanel visible={visible && !notesOpen} autoFocus={false} focusRequest={focusRequest} pageId={page.id} spaceId={page.spaceId} pageTitle={page.title} canEdit={page.capabilities?.canEdit === true} canAccept={false} onDocumentWritten={onDocumentWritten} supportsScopedApply snapshot={() => ({ title: page.title, content: page.content, updatedAt: page.updatedAt })} assistTargets={{ selection: target }} assistRequest={notes.assistRequest} onRequestHandled={notes.onRequestHandled} notesReady={notes.loaded} onNotesEvent={notes.onNotesEvent} />
    </div>, agentContainer) : null}
  </>;
}
