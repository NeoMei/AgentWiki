import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useBeforeUnload,
  useBlocker,
  useNavigate,
  type NavigateFunction,
} from 'react-router-dom';

export type SpaceNavSection = 'pages' | 'graph' | 'sources' | 'runs' | 'collaboration' | 'members' | 'settings';

export interface WorkspacePosition {
  pageId: string;
  cursorOffset: number | null;
  headingId: string | null;
  headingText: string | null;
  sourceOffset: number | null;
  scrollTop: number;
}

const workspacePositions = new Map<string, WorkspacePosition>();

export const renderedHeadingText = (heading: HTMLElement): string => {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"], .heading-anchor').forEach((node) => node.remove());
  return clone.textContent?.trim() ?? '';
};

export const rememberWorkspacePosition = (entryKey: string, position: WorkspacePosition) => {
  workspacePositions.set(entryKey, position);
};

export const readWorkspacePosition = (entryKey: string, pageId: string): WorkspacePosition | null => {
  const position = workspacePositions.get(entryKey);
  return position?.pageId === pageId ? position : null;
};

export const nearestMarkdownSourceBlock = (
  blocks: Iterable<HTMLElement>,
  boundary: number,
): HTMLElement | null => {
  let nearest: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const distance = Math.abs(block.getBoundingClientRect().top - boundary);
    if (distance < nearestDistance) {
      nearest = block;
      nearestDistance = distance;
    }
  }
  return nearest;
};

export const captureReadingPosition = (root: HTMLElement, stickyBottom = 0, pageId = ''): WorkspacePosition => {
  const headings = [...root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-markdown-source-start]')];
  const currentHeadingBoundary = stickyBottom + 12;
  let nearest: HTMLElement | null = null;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= currentHeadingBoundary) nearest = heading;
    else break;
  }
  const nearestBlock = nearestMarkdownSourceBlock(blocks, currentHeadingBoundary);
  const sourceOffset = Number(nearestBlock?.dataset.markdownSourceStart);
  return {
    pageId,
    cursorOffset: null,
    headingId: nearest?.id ?? null,
    headingText: nearest ? renderedHeadingText(nearest) || null : null,
    sourceOffset: Number.isFinite(sourceOffset) ? sourceOffset : null,
    scrollTop: window.scrollY,
  };
};

interface NavigationGuardContextValue {
  register: (owner: symbol, message: string | null) => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

const locationsDiffer = (
  current: { pathname: string; search: string; hash: string },
  next: { pathname: string; search: string; hash: string },
) => current.pathname !== next.pathname || current.search !== next.search || current.hash !== next.hash;

/**
 * Owns the single router blocker for the application. Editors register their
 * dirty message here, so every Link, navigate() call and POP transition is
 * stopped before React Router changes the active location.
 */
export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [guards, setGuards] = useState<ReadonlyMap<symbol, string>>(() => new Map());
  const message = guards.values().next().value as string | undefined;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    Boolean(message) && locationsDiffer(currentLocation, nextLocation)
  ));

  const register = useCallback((owner: symbol, nextMessage: string | null) => {
    setGuards((current) => {
      const existing = current.get(owner);
      if (nextMessage === existing || (!nextMessage && existing === undefined)) return current;
      const next = new Map(current);
      if (nextMessage) next.set(owner, nextMessage);
      else next.delete(owner);
      return next;
    });
  }, []);

  useBeforeUnload(useCallback((event) => {
    if (!message) return;
    event.preventDefault();
    event.returnValue = '';
  }, [message]));

  useEffect(() => {
    if (blocker.state !== 'blocked' || !message) return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);

  const value = useMemo(() => ({ register }), [register]);
  return React.createElement(NavigationGuardContext.Provider, { value }, children);
};

/** Register or clear a dirty-editor guard without coupling callers to router internals. */
export const useDirtyNavigationGuard = (active: boolean, message: string) => {
  const context = useContext(NavigationGuardContext);
  const ownerRef = useRef(Symbol('navigation-guard-owner'));
  useLayoutEffect(() => {
    if (!context) return;
    const owner = ownerRef.current;
    context.register(owner, active ? message : null);
    return () => context.register(owner, null);
  }, [active, context, message]);
};

/**
 * Navigation entry point for workspace controllers. The provider performs the
 * actual blocking, so this keeps the standard NavigateFunction contract.
 */
export const useGuardedNavigate = (): NavigateFunction => useNavigate();

const segment = (value: string) => encodeURIComponent(value);

export const folderIdFromSearch = (search: string | URLSearchParams): string | null => {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const folderId = params.get('folder');
  return folderId || null;
};

export const spaceFolderHref = (spaceId: string, folderId: string | null | undefined): string => {
  const pathname = `/spaces/${segment(spaceId)}`;
  return folderId ? `${pathname}?folder=${segment(folderId)}` : pathname;
};

export const isWorkspacePath = (pathname: string): boolean => (
  /^\/spaces\/[^/]+(?:\/|$)/u.test(pathname)
  || /^\/pages\/[^/]+(?:\/|$)/u.test(pathname)
);

export const workspaceSectionFromPath = (pathname: string): SpaceNavSection | null => {
  if (/^\/pages\/[^/]+(?:\/|$)/u.test(pathname)) return 'pages';
  const match = pathname.match(/^\/spaces\/[^/]+(?:\/([^/]+))?/u);
  if (!match) return null;
  const section = match[1];
  if (!section) return 'pages';
  return (['graph', 'sources', 'runs', 'collaboration', 'members', 'settings'] as const)
    .find((candidate) => candidate === section) ?? null;
};
