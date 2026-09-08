import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, RouterProvider, createMemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  folderIdFromSearch,
  captureReadingPosition,
  isWorkspacePath,
  NavigationGuardProvider,
  readWorkspacePosition,
  rememberWorkspacePosition,
  spaceFolderHref,
  useDirtyNavigationGuard,
  workspaceSectionFromPath,
} from './workspaceNavigation';

const GuardHarness = () => {
  const location = useLocation();
  const navigate = useNavigate();
  useDirtyNavigationGuard(true, 'Leave dirty editor?');
  return React.createElement(React.Fragment, null,
    React.createElement('p', { 'data-testid': 'location' }, location.pathname),
    React.createElement('textarea', { 'aria-label': 'Draft', defaultValue: 'Unsaved body' }),
    React.createElement(Link, { to: '/linked' }, 'Linked route'),
    React.createElement('button', { type: 'button', onClick: () => navigate('/programmatic') }, 'Programmatic route'),
    React.createElement('button', { type: 'button', onClick: () => navigate(-1) }, 'Browser back'),
  );
};

const renderGuardHarness = () => {
  const router = createMemoryRouter([{
    path: '*',
    element: React.createElement(NavigationGuardProvider, null, React.createElement(GuardHarness)),
  }], { initialEntries: ['/previous', '/editor'], initialIndex: 1 });
  render(React.createElement(RouterProvider, { router }));
};

describe('workspaceNavigation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the folder query parameter as the directory selection source of truth', () => {
    expect(folderIdFromSearch('?folder=folder%2Ftwo')).toBe('folder/two');
    expect(folderIdFromSearch('?view=list')).toBeNull();
    expect(spaceFolderHref('space/one', 'folder/two')).toBe('/spaces/space%2Fone?folder=folder%2Ftwo');
    expect(spaceFolderHref('space/one', null)).toBe('/spaces/space%2Fone');
  });

  it('classifies only space and page routes as workspace paths', () => {
    expect(isWorkspacePath('/spaces/space-1/settings/page-templates')).toBe(true);
    expect(isWorkspacePath('/pages/page-1/edit')).toBe(true);
    expect(isWorkspacePath('/search')).toBe(false);
    expect(isWorkspacePath('/profile')).toBe(false);
  });

  it('assigns nested collaboration and settings routes to their parent section', () => {
    expect(workspaceSectionFromPath('/spaces/space-1/collaboration/runs/run-1')).toBe('collaboration');
    expect(workspaceSectionFromPath('/spaces/space-1/settings/page-templates')).toBe('settings');
    expect(workspaceSectionFromPath('/pages/page-1/versions')).toBe('pages');
  });

  it('captures the last visible rendered heading instead of deriving a pixel ratio', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2 id="intro">Intro<a class="heading-anchor" aria-hidden="true">#</a></h2><p>One</p><h2 id="details">Details<a class="heading-anchor" aria-hidden="true">#</a></h2><p>Two</p>';
    const headings = root.querySelectorAll('h2');
    vi.spyOn(headings[0], 'getBoundingClientRect').mockReturnValue({ top: 40 } as DOMRect);
    vi.spyOn(headings[1], 'getBoundingClientRect').mockReturnValue({ top: 132 } as DOMRect);

    expect(captureReadingPosition(root, 120, 'page-1')).toEqual({
      pageId: 'page-1',
      cursorOffset: null,
      headingId: 'details',
      headingText: 'Details',
      scrollTop: window.scrollY,
    });
  });

  it('restores history positions only for the matching route entry key', () => {
    rememberWorkspacePosition('entry-a', { pageId: 'page-a', cursorOffset: 12, headingId: null, headingText: 'A', scrollTop: 80 });
    rememberWorkspacePosition('entry-b', { pageId: 'page-b', cursorOffset: null, headingId: 'b', headingText: 'B', scrollTop: 240 });

    expect(readWorkspacePosition('entry-a', 'page-a')).toEqual({ pageId: 'page-a', cursorOffset: 12, headingId: null, headingText: 'A', scrollTop: 80 });
    expect(readWorkspacePosition('entry-a', 'page-b')).toBeNull();
    expect(readWorkspacePosition('missing', 'page-a')).toBeNull();
  });

  it.each([
    ['Link', 'Linked route'],
    ['navigate', 'Programmatic route'],
    ['POP', 'Browser back'],
  ])('blocks %s before a dirty editor leaves and keeps its draft when cancelled', async (_kind, actionName) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderGuardHarness();

    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'Unsaved changed body' } });
    fireEvent.click(screen.getByText(actionName));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Leave dirty editor?'));
    expect(screen.getByTestId('location')).toHaveTextContent('/editor');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved changed body');
  });

  it('continues the blocked transition only after the user confirms leaving', async () => {
    class RouterTestRequest {
      readonly url: string;
      readonly signal: AbortSignal | null;
      readonly method: string;

      constructor(input: string | URL | Request, init?: RequestInit) {
        this.url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
        this.signal = init?.signal ?? null;
        this.method = init?.method ?? 'GET';
      }
    }
    vi.stubGlobal('Request', RouterTestRequest as unknown as typeof Request);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderGuardHarness();

    fireEvent.click(screen.getByRole('link', { name: 'Linked route' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/linked'));
  });

});
