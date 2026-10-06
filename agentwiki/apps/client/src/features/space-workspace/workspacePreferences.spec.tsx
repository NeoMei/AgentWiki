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


describe('right panel preference compatibility', () => {
  it('keeps old records automatic and validates only the new UI preference fields', () => {
    const key = 'agentwiki.workspace.v1:alice:wiki';
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, directoryWidth: 300 }));
    expect(readWorkspacePreferences('alice', 'wiki')).toMatchObject({ outlineOpen: undefined, outlineWidth: 280, collaborationOpen: false, collaborationTab: 'assist', collaborationWidth: 320 });
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, outlineOpen: 'false', outlineWidth: 999, collaborationOpen: true, collaborationTab: 'invalid', collaborationWidth: null, candidate: 'never persist' }));
    const result = readWorkspacePreferences('alice', 'wiki');
    expect(result).toMatchObject({ outlineOpen: undefined, outlineWidth: 360, collaborationOpen: true, collaborationTab: 'assist', collaborationWidth: 320 });
    writeWorkspacePreferences('alice', 'wiki', result);
    expect(localStorage.getItem(key)).not.toContain('never persist');
  });
});


const PanelProbe = () => {
  const state = useSpaceWorkspace();
  return <><output data-testid="panel-preferences">{JSON.stringify({ open: state.outlineOpen, width: state.outlineWidth, collaboration: state.collaborationOpen, tab: state.collaborationTab, collaborationWidth: state.collaborationWidth })}</output><button onClick={() => state.setPanelPreferences({ outlineOpen: false, outlineWidth: 350, collaborationOpen: true, collaborationTab: 'notes', collaborationWidth: 490 })}>change panels</button></>;
};
const PanelHarness = ({ user = 'alice', space = 'wiki' }: { user?: string; space?: string }) => <SpaceWorkspaceProvider userId={user}><SpaceWorkspaceScope mode="read" spaceId={space} activeSection="pages" selectedFolderId={null} selectedPageId={null} selectedPageFolderId={null} pageRefreshRequest={0} selectFolder={vi.fn()} reportPageIdentity={vi.fn()} requestPageRefresh={vi.fn()}><PanelProbe /></SpaceWorkspaceScope></SpaceWorkspaceProvider>;
const panelValue = () => JSON.parse(screen.getByTestId('panel-preferences').textContent!);
describe('scoped panel registry', () => {
  it('remembers explicit choices through scope/account changes and remount', () => {
    const view = render(<PanelHarness />); fireEvent.click(screen.getByText('change panels'));
    expect(panelValue()).toEqual({ open: false, width: 350, collaboration: true, tab: 'notes', collaborationWidth: 490 });
    view.rerender(<PanelHarness space="other" />); expect(panelValue()).toMatchObject({ collaboration: false, tab: 'assist', width: 280 });
    view.rerender(<PanelHarness user="bob" />); expect(panelValue().open).toBeUndefined();
    view.rerender(<PanelHarness />); expect(panelValue().tab).toBe('notes');
    view.unmount(); render(<PanelHarness />); expect(panelValue().collaborationWidth).toBe(490);
  });
  it('retains panel choices in memory while localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const view = render(<PanelHarness />); fireEvent.click(screen.getByText('change panels'));
    view.rerender(<PanelHarness space="other" />); view.rerender(<PanelHarness />);
    expect(panelValue()).toMatchObject({ open: false, collaboration: true, tab: 'notes', collaborationWidth: 490 });
    view.unmount(); vi.restoreAllMocks();
  });
  it.each([null, '320', -10, 999])('handles malformed/out-of-range stored widths %s', (width) => {
    localStorage.setItem('agentwiki.workspace.v1:alice:wiki', JSON.stringify({ schemaVersion: 1, outlineWidth: width, collaborationWidth: width }));
    const result = readWorkspacePreferences('alice', 'wiki');
    expect(result.outlineWidth).toBe(typeof width === 'number' ? (width < 200 ? 200 : 360) : 280);
    expect(result.collaborationWidth).toBe(typeof width === 'number' ? (width < 320 ? 320 : 520) : 320);
  });
});
