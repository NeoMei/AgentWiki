import React from 'react';

export interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-2xl',
} as const;

export function userInitials(name?: string | null, email?: string | null): string {
  const value = (name || email || '?').trim();
  const parts = value.split(/\s+/u).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ name, email, size = 'md' }) => (
  <div
    aria-hidden="true"
    className={`${sizeClasses[size]} shrink-0 rounded-full bg-blue-100 font-semibold text-blue-700 flex items-center justify-center`}
  >
    {userInitials(name, email)}
  </div>
);
