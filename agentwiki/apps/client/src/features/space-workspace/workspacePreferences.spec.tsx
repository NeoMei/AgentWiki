import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspacePreferences, writeWorkspacePreferences } from './workspacePreferences';
import { SpaceWorkspaceProvider, SpaceWorkspaceScope, useSpaceWorkspace } from './SpaceWorkspaceContext';
const Probe = () => {
  const state = useSpaceWorkspace();
  return <><output data-testid="preferences">{JSON.stringify({ expanded: [...state.expandedFolderIds], scroll: state.directoryScrollTop, width: state.directoryWidth, collapsed: state.directoryCollapsed })}</output><button onClick={() => { state.setFolderExpanded('guide', true); state.setDirectoryScrollTop(137); state.setDirectoryWidth?.(320); state.setDirectoryCollapsed(true); }}>change preferences</button></>;
};
const Harness = ({ user = 'alice', space = 'wiki' }: { user?: string; space?: string }) => <SpaceWorkspaceProvider userId={user}><SpaceWorkspaceScope mode="read" spaceId={space} activeSection="pages" selectedFolderId={null} selectedPageId={null} selectedPageFolderId={null} pageRefreshRequest={0} selectFolder={vi.fn()} reportPageIdentity={vi.fn()} requestPageRefresh={vi.fn()}><Probe /></SpaceWorkspaceScope></SpaceWorkspaceProvider>;
const value = () => JSON.parse(screen.getByTestId('preferences').textContent!);
beforeEach(() => localStorage.clear());
describe('persistent directory preferences', () => {
  it('restores expansion, scroll, width and collapse after remount', () => {
    const first = render(<Harness />); fireEvent.click(screen.getByText('change preferences')); first.unmount(); render(<Harness />);
    expect(value()).toEqual({ expanded: ['guide'], scroll: 137, width: 320, collapsed: true });
  });
  it('isolates users and Spaces, including identity changes', () => {
    const view = render(<Harness />); fireEvent.click(screen.getByText('change preferences')); view.rerender(<Harness user="bob" />); expect(value().expanded).toEqual([]); view.rerender(<Harness space="other" />); expect(value().expanded).toEqual([]); view.rerender(<Harness />); expect(value().expanded).toEqual(['guide']);
  });
  it('remains usable when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); }); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const view = render(<Harness />); fireEvent.click(screen.getByText('change preferences')); expect(value().width).toBe(320); expect(value().expanded).toEqual(['guide']); view.unmount(); vi.restoreAllMocks();
  });
});

describe('preference validation', () => {
  it('falls back on malformed JSON and ignores unknown schemas', () => {
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', '{'); expect(readWorkspacePreferences('alice', 'wiki').directoryWidth).toBe(260);
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 99, directoryWidth: 410 })); expect(readWorkspacePreferences('alice', 'wiki').directoryWidth).toBe(260);
  });
  it('validates loaded fields and clamps dimensions without retaining foreign content', () => {
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 1, expandedFolderIds: ['guide', null, 1], directoryWidth: 900, directoryScrollTop: -1, directoryCollapsed: 'yes', content: 'private text' }));
    const result = readWorkspacePreferences('alice', 'wiki'); expect([...result.expandedFolderIds]).toEqual(['guide']); expect(result.directoryWidth).toBe(420); expect(result.directoryScrollTop).toBe(0); expect(result.directoryCollapsed).toBe(false);
    writeWorkspacePreferences('alice', 'wiki', result); expect(localStorage.getItem('agentwiki.workspace.v1:alice:wiki')).not.toContain('private text');
  });
});
