import { UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface Props { userId?: string | null; language: string }

/** Stored ownership is authoritative; the signed-in profile only names an exact ID match. */
export function PersonalNoteAuthor({ userId, language }: Props) {
  const { user } = useAuth();
  const zh = language === 'zh-CN';
  const knownId = typeof userId === 'string' && userId.trim().length > 0;
  const isCurrentUser = knownId && userId === user?.id;
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  const profileName = name || email;
  const label = isCurrentUser
    ? (profileName ? `${profileName} (${zh ? '我' : 'you'})` : (zh ? '我' : 'You'))
    : knownId ? `${zh ? '用户' : 'User'} ${userId}` : (zh ? '未知用户' : 'Unknown user');
  return <span aria-label={`${zh ? '笔记作者' : 'Note author'}: ${label}`} title={knownId ? `${label} · ${userId}` : label} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-gray-500">
    <UserRound size={13} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">{label}</span>
  </span>;
}
