import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Users, X } from 'lucide-react';
import api from '../../api/client';

export interface NoteCollaborator {
  userId: string;
  name: string;
  email: string;
  role?: string;
}
interface MemberResponse {
  userId?: string;
  type?: string;
  role?: string;
  user?: { id?: string; name?: string | null; email?: string | null; type?: string };
}

interface Props {
  spaceId: string;
  language: string;
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  disabled?: boolean;
  openSignal?: number;
}

/** Selects human Space members for a new page note. Agent grants are deliberately excluded. */
export function NoteCollaboratorPicker({ spaceId, language, selectedUserIds, onChange, disabled = false, openSignal = 0 }: Props) {
  const zh = language === 'zh-CN';
  const [members, setMembers] = useState<NoteCollaborator[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);

  useEffect(() => {
    let active = true;
    setMembers([]); setQuery(''); setOpen(false); setFailed(false);
    if (!spaceId) return () => { active = false; };
    setLoading(true);
    api.get<MemberResponse[]>(`/spaces/${encodeURIComponent(spaceId)}/members`)
      .then(({ data }) => {
        if (!active) return;
        setMembers((Array.isArray(data) ? data : []).filter((member) => member.type === 'human' && member.user?.type !== 'agent' && !!member.userId)
          .map((member) => ({ userId: member.userId!, name: member.user?.name?.trim() || member.user?.email || member.userId!, email: member.user?.email || '', role: member.role })));
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spaceId]);

  useEffect(() => { if (openSignal > 0 && !disabled) setOpen(true); }, [openSignal, disabled]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  const filtered = members.filter((member) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${member.name} ${member.email}`.toLocaleLowerCase().includes(needle);
  });
  const toggle = (userId: string) => onChange(selected.has(userId) ? selectedUserIds.filter((id) => id !== userId) : [...selectedUserIds, userId]);
  const remove = (userId: string) => onChange(selectedUserIds.filter((id) => id !== userId));
  const selectedMembers = members.filter((member) => selected.has(member.userId));

  return <div ref={rootRef} className="space-y-1.5" data-testid="note-collaborator-picker">
    <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
      <Users size={14} aria-hidden="true" />
      <span>{zh ? '协作人（可选）' : 'Collaborators (optional)'}</span>
    </div>
    {selectedMembers.length > 0 ? <div className="flex flex-wrap gap-1.5" aria-label={zh ? '已选协作人' : 'Selected collaborators'}>
      {selectedMembers.map((member) => <span key={member.userId} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
        {member.name}<button type="button" aria-label={`${zh ? '移除' : 'Remove'} ${member.name}`} disabled={disabled} onClick={() => remove(member.userId)} className="rounded-full hover:bg-blue-100 disabled:opacity-40"><X size={12} /></button>
      </span>)}
    </div> : null}
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)} className="flex min-h-9 w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-500 hover:border-blue-300 disabled:opacity-50">
        <span>{loading ? (zh ? '加载成员…' : 'Loading members…') : (zh ? '选择 Space 协作人' : 'Choose Space collaborators')}</span>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open ? <div role="listbox" aria-label={zh ? 'Space 人类成员' : 'Human Space members'} className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
        <input autoFocus aria-label={zh ? '搜索协作人' : 'Search collaborators'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索姓名或邮箱' : 'Search name or email'} className="mb-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
        {failed ? <p role="alert" className="px-2 py-2 text-xs text-amber-700">{zh ? '成员加载失败，请稍后重试。' : 'Members could not be loaded. Try again later.'}</p> : null}
        {!failed && !loading && filtered.length === 0 ? <p className="px-2 py-2 text-xs text-gray-500">{zh ? '没有匹配的人类成员' : 'No matching human members'}</p> : null}
        {filtered.map((member) => <button key={member.userId} type="button" role="option" aria-selected={selected.has(member.userId)} onClick={() => toggle(member.userId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-blue-50">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 font-medium text-gray-600">{member.name.slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1 truncate">{member.name}<span className="ml-1 text-gray-400">{member.email}</span></span>{selected.has(member.userId) ? <Check size={14} className="text-blue-600" /> : null}
        </button>)}
      </div> : null}
    </div>
  </div>;
}
