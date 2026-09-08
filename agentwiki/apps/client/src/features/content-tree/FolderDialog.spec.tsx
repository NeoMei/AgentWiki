import { act, fireEvent, render, screen } from '@testing-library/react';
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
        targetLocation="产品知识库 / 设计资料"
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
    expect(screen.getByText('创建位置：产品知识库 / 设计资料')).toBeInTheDocument();
  });

  it('identifies the folder being renamed by its full Space path and restores trigger focus', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Rename design assets';
    document.body.append(trigger);
    const onClose = vi.fn();
    const { unmount } = renderWithLanguage(
      <FolderDialog
        mode="rename"
        initialName="设计资料"
        targetLocation="产品知识库 / 项目甲 / 设计资料"
        returnFocusTo={trigger}
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('重命名对象：产品知识库 / 项目甲 / 设计资料')).toBeInTheDocument();
    const cancelButtons = screen.getAllByRole('button', { name: '取消' });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => Promise.resolve());
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('renders the delete dialog as an opaque, bounded modal surface', () => {
    renderWithLanguage(
      <FolderDeleteDialog
        spaceId="space-1"
        folderId="folder-1"
        folderName="设计资料"
        targetLocation="产品知识库 / 项目甲 / 设计资料"
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
    expect(screen.getByText('删除对象：产品知识库 / 项目甲 / 设计资料')).toBeInTheDocument();
  });
});
