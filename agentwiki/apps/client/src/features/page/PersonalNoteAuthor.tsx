import { Bot, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

import type { NoteAuthor } from './reviewComments';
interface Props { userId?: string | null; author?: NoteAuthor; language: string }

/** Stored ownership is authoritative; the signed-in profile only names an exact ID match. */
export function PersonalNoteAuthor({ userId, author, language }: Props) {
  const { user } = useAuth();
  const zh = language === 'zh-CN';
  userId = author?.type === 'user' ? author.id : author ? null : userId;
  const knownId = typeof userId === 'string' && userId.trim().length > 0;
  const isCurrentUser = knownId && userId === user?.id;
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  const profileName = author?.name.trim() || name || email;
  const label = author?.type === 'agent' ? author.name.trim() || author.id : author && !isCurrentUser ? author.name.trim() || `${zh ? '用户' : 'User'} ${author.id}` : isCurrentUser
    ? (profileName ? `${profileName} (${zh ? '我' : 'you'})` : (zh ? '我' : 'You'))
    : knownId ? `${zh ? '用户' : 'User'} ${userId}` : (zh ? '未知用户' : 'Unknown user');
  return <span aria-label={`${zh ? '笔记作者' : 'Note author'}: ${label}`} title={knownId ? `${label} · ${userId}` : label} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-gray-500">
    {author?.type === 'agent' ? <Bot size={13} aria-hidden="true" className="shrink-0" /> : <UserRound size={13} aria-hidden="true" className="shrink-0" />}<span className="min-w-0 truncate">{label}</span>{author?.type === 'agent' ? <span className="shrink-0 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-600">Agent</span> : null}
  </span>;
}
