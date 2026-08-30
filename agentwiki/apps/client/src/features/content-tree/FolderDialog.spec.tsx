import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { FolderDeleteDialog } from './FolderDeleteDialog';
import { FolderDialog } from './FolderDialog';

const renderWithLanguage = (children: React.ReactNode) => render(
  <LanguageProvider>{children}</LanguageProvider>,
);

describe('folder dialogs', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('renders the create dialog as an opaque, bounded modal surface', () => {
    renderWithLanguage(
      <FolderDialog
        mode="create"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '新建文件夹' })).toHaveClass(
      'w-full',
      'max-w-md',
      'rounded-[14px]',
      'bg-white',
      'shadow-xl',
    );
  });

  it('renders the delete dialog as an opaque, bounded modal surface', () => {
    renderWithLanguage(
      <FolderDeleteDialog
        spaceId="space-1"
        folderId="folder-1"
        folderName="设计资料"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '删除文件夹' })).toHaveClass(
      'w-full',
      'max-w-md',
      'rounded-[14px]',
      'bg-white',
      'shadow-xl',
    );
  });
});
