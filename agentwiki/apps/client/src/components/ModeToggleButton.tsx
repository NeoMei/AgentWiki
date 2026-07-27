import React from 'react';
import { BookOpen, PenLine } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// Obsidian-style single icon that flips between reading and editing. The icon
// and placement stay identical across views; only the glyph changes to signal
// the action (pen = enter edit, book = enter reading).
export const ModeToggleButton: React.FC<{
  mode: 'edit' | 'preview';
  onToggle: () => void;
}> = ({ mode, onToggle }) => {
  const { t } = useLanguage();
  const isEdit = mode === 'edit';
  const label = isEdit ? t('common.preview') : t('common.edit');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isEdit}
      aria-label={label}
      title={label}
      data-testid="mode-toggle"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {isEdit ? <BookOpen size={18} aria-hidden="true" /> : <PenLine size={18} aria-hidden="true" />}
    </button>
  );
};
