import { useLanguage } from '../../context/LanguageContext';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import type { usePersonalNotes } from '../page/usePersonalNotes';
import { PersonalNotesPanel } from '../page/PersonalNotesPanel';
import { captureAssistTarget, type AssistTarget } from '../page/assistTargets';
import { AgentSessionPanel } from './AgentSessionPanel';
export function AgentReadingSidebar({ page, notes, activeNoteId, onLocateNote, onClearActiveNote, visible = true, notesOpen, notesContainer, agentContainer, focusRequest, target, selectionUnavailable, onTarget, onOpenAgent }: {
  page: { id: string; spaceId: string; title: string; content: string; updatedAt: string; capabilities?: { canEdit?: boolean } };
  visible?: boolean; notesOpen: boolean; target: AssistTarget | null; selectionUnavailable: boolean; onTarget: (target: AssistTarget | null) => void; onOpenAgent: () => void;
  notesContainer: HTMLElement | null; agentContainer: HTMLElement | null; focusRequest?: string;
  notes: ReturnType<typeof usePersonalNotes>; activeNoteId: string | null; onLocateNote: (id: string) => boolean; onClearActiveNote: () => void;
}) {
  const { user } = useAuth(), { language } = useLanguage(), zh = language === 'zh-CN';
  return <>
    {notesContainer ? createPortal(<div className="min-h-0 flex-1 overflow-auto p-3">
      {selectionUnavailable ? <p role="status" className="mb-2 text-sm text-amber-800">{zh ? '此选区无法安全对应原始 Markdown。请在下方原文中选择准确片段；有编辑权限也可进入编辑页定位。' : 'This selection cannot be mapped safely to Markdown. Select an exact excerpt in the source below, or locate it in the editor if you have edit access.'}</p> : null}
      <details open={selectionUnavailable} className="mb-3 rounded-lg border border-gray-200 p-2 text-sm"><summary>{zh ? '选择原始 Markdown 片段' : 'Select a raw Markdown excerpt'}</summary><p className="my-2 text-xs text-gray-500">{zh ? '只读原文。选中片段后，核对下方引文再添加笔记。' : 'Read-only source. Select an excerpt and review the exact quote below before adding a note.'}</p><textarea aria-label={zh ? '原始 Markdown 选区' : 'Raw Markdown selection'} readOnly rows={7} value={page.content} className="w-full rounded-lg border border-gray-200 p-2 font-mono text-xs" onSelect={(e) => onTarget(captureAssistTarget(page.content, 'selection', e.currentTarget.selectionStart, e.currentTarget.selectionEnd, page.updatedAt))} /></details>
      {!notes.loaded ? <p role="status" className="mb-2 text-sm text-gray-500">{zh ? '正在加载页面笔记…' : 'Loading page notes…'}</p> : null}
      {notes.conflict ? <p role="alert">{zh ? '选文已变化或笔记超过长度限制，请检查后重试。' : 'The passage changed or notes exceed the limit. Check and retry.'}</p> : null}
      <PersonalNotesPanel stageForSession identityKey={notes.identityKey} syncing={notes.syncing} onRetrySync={notes.retrySync} createDisabled={!notes.canCreate || notes.syncing} source={page.content} target={target} notes={notes.notes} activeNoteId={visible && notesOpen ? activeNoteId : null} onLocate={onLocateNote} onClearActive={onClearActiveNote} disabled={!user?.id || !notes.loaded || !!notes.assistRequest} storageUnavailable={notes.storageUnavailable} onAdd={notes.add} onReopen={notes.reopen} onDispatch={(ids) => { if (notes.dispatch(ids)) onOpenAgent(); }} />
    </div>, notesContainer) : null}
    {agentContainer ? createPortal(<div className="flex min-h-0 flex-1 flex-col">
      <AgentSessionPanel visible={visible && !notesOpen} autoFocus={false} focusRequest={focusRequest} pageId={page.id} spaceId={page.spaceId} pageTitle={page.title} canEdit={page.capabilities?.canEdit === true} canAccept={false} supportsScopedApply snapshot={() => ({ title: page.title, content: page.content, updatedAt: page.updatedAt })} assistTargets={{ selection: target }} assistRequest={notes.assistRequest} onRequestHandled={notes.onRequestHandled} notesReady={notes.loaded} onNotesEvent={notes.onNotesEvent} />
    </div>, agentContainer) : null}
  </>;
}
