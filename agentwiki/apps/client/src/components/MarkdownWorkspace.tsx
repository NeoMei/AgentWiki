import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isolateHistory } from '@codemirror/commands';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { ChangeDesc, EditorSelection, Range, StateEffect, StateField, Transaction, Prec } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { syntaxTree } from '@codemirror/language';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { useLanguage } from '../context/LanguageContext';
import { Markdown } from './Markdown';
import { toggleMarkdownTask } from './markdown/tasks';
import { PageLinkTarget, resolveWikiHref } from './markdownLinks';
import { canonicalWikiReferenceKey, parseWikiReference } from './markdown/obsidian';
import {
  collectMarkdownResourceOccurrences,
  resolveMarkdownResources,
  type MarkdownResourceOccurrence,
  type MarkdownResourceMap,
} from './markdown/resources';
import { formatAttachmentReference } from '../features/attachments/attachmentReference';
import { outlineFor } from './markdown-tools/outline';
import { insertionTransaction, slashRange, type InsertCommand } from './markdown-tools/commands';
import { menuPosition, type MenuPosition } from './markdown-tools/menuPosition';
import { DocumentTools, type MarkdownSelection } from './markdown-tools/DocumentTools';
import { ArticleContentsPopover } from '../features/space-workspace/ArticleContentsPopover';
import { nearestMarkdownSourceBlock } from '../features/space-workspace/workspaceNavigation';

export type MarkdownMode = 'edit' | 'preview';

interface MarkdownWorkspaceProps {
  value: string;
  mode: MarkdownMode;
  onChange: (next: string) => void;
  onModeChange?: (mode: MarkdownMode) => void;
  pageId?: string;
  spaceId?: string;
  pages?: PageLinkTarget[];
  onUploadImages?: (files: File[]) => Promise<string[]>;
  onUploadError?: (error: unknown) => void;
  onSelectionChange?: (selection: MarkdownSelection) => void;
  onRequestAssist?: (selection: MarkdownSelection) => void;
  onRequestPageLinks?: () => Promise<PageLinkTarget[]>;
  outlineOverlay?: boolean;
  pageLinksIdentity?: string;
}

export interface MarkdownWorkspaceHandle {
  /** Test hook: drive a content change as if the user typed it. */
  simulateChange: (next: string) => void;
  currentValue: () => string;
  /** Single isolated undoable replacement; false when no editing surface is mounted. */
  replaceDocument: (next: string) => boolean;
  insertText: (text: string) => void;
  captureSelection: () => MarkdownSelection;
  restoreSelection: (selection: MarkdownSelection) => boolean;
  capturePosition: () => MarkdownWorkspacePosition;
  restorePosition: (position: MarkdownWorkspacePosition) => void;
}

interface MarkdownSelectionBookmark {
  readonly anchor: number;
  readonly head: number;
}

export interface MarkdownWorkspacePosition {
  cursorOffset: number | null;
  headingId: string | null;
  headingText: string | null;
  sourceOffset: number | null;
  scrollTop: number;
  /** Coordinates only; restoration also requires this workspace's in-memory source proof. */
  selectionBookmark?: MarkdownSelectionBookmark;
}

const cursorForHeading = (value: string, headingText: string | null): number =>
  outlineFor(value).find((item) => item.label === headingText)?.to ?? 0;
const nearestMarkdownHeading = (value: string, cursorOffset: number): string | null =>
  outlineFor(value).filter((item) => item.from <= cursorOffset).slice(-1)[0]?.label ?? null;

const renderedHeadingLabel = (heading: HTMLElement): string => {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"], .heading-anchor').forEach((node) => node.remove());
  return clone.textContent?.trim() ?? '';
};

const markdownBlockSourceStart = (source: string, cursorOffset: number): number => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  const blockTypes = new Set([
    'heading', 'paragraph', 'code', 'listItem', 'blockquote', 'table', 'thematicBreak', 'html',
  ]);
  let bestStart: number | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  visit(tree, (node) => {
    if (!blockTypes.has(node.type)) return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start !== 'number' || typeof end !== 'number' || cursorOffset < start || cursorOffset > end) return;
    if (end - start < bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
  });
  return bestStart ?? cursorOffset;
};

const markdownSourceStart = (element: HTMLElement | null): number | null => {
  const offset = Number(element?.dataset.markdownSourceStart);
  return Number.isFinite(offset) ? offset : null;
};

const renderedBlockAtOffset = (root: HTMLElement, sourceOffset: number): HTMLElement | null => {
  let nearest: HTMLElement | null = null;
  for (const block of root.querySelectorAll<HTMLElement>('[data-markdown-source-start]')) {
    const blockOffset = markdownSourceStart(block);
    if (blockOffset === null || blockOffset > sourceOffset) break;
    nearest = block;
  }
  return nearest;
};

interface UploadAnchor {
  id: number;
  selection: EditorSelection;
}

const addUploadAnchor = StateEffect.define<UploadAnchor>();
const removeUploadAnchor = StateEffect.define<number>();
const replaceUploadAnchors = StateEffect.define<Map<number, EditorSelection>>();
const mapUploadSelection = (selection: EditorSelection, changes: ChangeDesc) => EditorSelection.create(
  selection.ranges.map((range) => {
    if (range.empty) return EditorSelection.cursor(changes.mapPos(range.from, 1), 1);
    const forward = range.anchor <= range.head;
    return EditorSelection.range(
      changes.mapPos(range.anchor, forward ? -1 : 1),
      changes.mapPos(range.head, forward ? 1 : -1),
    );
  }),
  selection.mainIndex,
);
const changesTouchNonEmptySelection = (selection: EditorSelection, changes: ChangeDesc) => {
  let touched = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (touched) return;
    for (const range of selection.ranges) {
      if (range.empty) continue;
      const intersects = fromA === toA
        ? fromA >= range.from && fromA <= range.to
        : fromA < range.to && toA > range.from;
      if (intersects) {
        touched = true;
        return;
      }
    }
  });
  return touched;
};
const uploadAnchors = StateField.define<Map<number, EditorSelection>>({
  create: () => new Map(),
  update: (anchors, transaction) => {
    const next = new Map<number, EditorSelection>();
    anchors.forEach((selection, id) => {
      if (!changesTouchNonEmptySelection(selection, transaction.changes)) {
        next.set(id, mapUploadSelection(selection, transaction.changes));
      }
    });
    for (const effect of transaction.effects) {
      if (effect.is(addUploadAnchor)) next.set(effect.value.id, effect.value.selection);
      if (effect.is(removeUploadAnchor)) next.delete(effect.value);
      if (effect.is(replaceUploadAnchors)) {
        next.clear();
        effect.value.forEach((selection, id) => next.set(id, selection));
      }
    }
    return next;
  },
});

const ACCEPTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ACCEPTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const hasAcceptedExtension = (name: string) => {
  const normalized = name.trim().toLowerCase();
  for (const extension of ACCEPTED_IMAGE_EXTENSIONS) {
    if (normalized.endsWith(extension)) return true;
  }
  return false;
};

const acceptedImageFile = (file: File, itemMime = '') => {
  const mimeTypes = [itemMime, file.type]
    .map((mime) => mime.trim().toLowerCase())
    .filter(Boolean);
  if (mimeTypes.length > 0) return mimeTypes.every((mime) => ACCEPTED_IMAGE_MIME_TYPES.has(mime));
  return hasAcceptedExtension(file.name);
};

const imageFilesFromTransfer = (transfer: DataTransfer | null): File[] => {
  if (!transfer) return [];
  const items = Array.from(transfer.items || []);
  if (items.length > 0) {
    const files: File[] = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && acceptedImageFile(file, item.type)) files.push(file);
    }
    return files;
  }
  return Array.from(transfer.files || []).filter((file) => acceptedImageFile(file));
};

const insertAtSelection = (
  view: EditorView,
  selection: EditorSelection,
  text: string,
  effects?: StateEffect<unknown>,
) => {
  const changes = view.state.changes(selection.ranges.map((range) => ({
    from: range.from,
    to: range.to,
    insert: text,
  })));
  const nextSelection = EditorSelection.create(
    selection.ranges.map((range) => EditorSelection.cursor(changes.mapPos(range.to, 1))),
    selection.mainIndex,
  );
  view.dispatch({ changes, selection: nextSelection, effects });
};

const insertUploadedText = (view: EditorView, anchorId: number, selection: EditorSelection, text: string) => {
  const changes = view.state.changes(selection.ranges.map((range) => ({
    from: range.from,
    to: range.to,
    insert: text,
  })));
  const nextSelection = EditorSelection.create(
    selection.ranges.map((range) => EditorSelection.cursor(changes.mapPos(range.to, 1))),
    selection.mainIndex,
  );
  const rebasedAnchors = new Map<number, EditorSelection>();
  view.state.field(uploadAnchors).forEach((pendingSelection, id) => {
    if (id === anchorId) return;
    if (pendingSelection.eq(selection)) {
      rebasedAnchors.set(id, nextSelection);
    } else if (!changesTouchNonEmptySelection(pendingSelection, changes)) {
      rebasedAnchors.set(id, mapUploadSelection(pendingSelection, changes));
    }
  });
  view.dispatch({
    changes,
    selection: nextSelection,
    effects: replaceUploadAnchors.of(rebasedAnchors),
    annotations: [Transaction.addToHistory.of(true), isolateHistory.of('full')],
  });
};

const uploadSelection = (selection: EditorSelection) => EditorSelection.create(
  selection.ranges.map((range) => (
    range.empty ? EditorSelection.cursor(range.from, 1) : EditorSelection.range(range.anchor, range.head)
  )),
  selection.mainIndex,
);

// Live-preview formatting: render markdown structure (headings, emphasis,
// quotes, code) while editing, like Obsidian. Cursor line still shows source.
const livePreviewStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '30px', fontWeight: '700', lineHeight: '1.3' },
  { tag: tags.heading2, fontSize: '24px', fontWeight: '700', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '20px', fontWeight: '700', lineHeight: '1.4' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.quote, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace', backgroundColor: '#f3f4f6', borderRadius: '3px', padding: '0 3px' },
  { tag: tags.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: tags.url, color: '#2563eb' },
  { tag: tags.processingInstruction, color: '#9ca3af', class: 'cm-md-marker' },
  { tag: tags.meta, color: '#9ca3af', class: 'cm-md-marker' },
]);

// Obsidian-style live preview: a single CodeMirror document where the line the
// cursor is on shows raw markdown and every other line is rendered with
// formatting (headings, bold, lists…). Preview mode is fully read-only render.

// Hide markdown markers (and the single space after a heading's `#` run) on
// every line except the one the cursor/selection is on, so non-active lines
// align flush with body text — like Obsidian. Active line keeps full source.
class WikiLinkWidget extends WidgetType {
  constructor(readonly name: string, readonly href: string | null) { super(); }
  eq(other: WikiLinkWidget) { return other.name === this.name && other.href === this.href; }
  toDOM() {
    const a = document.createElement('a');
    a.textContent = this.name;
    if (this.href) {
      a.href = this.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'text-blue-600 underline cursor-pointer';
    } else {
      a.className = 'text-gray-400';
    }
    return a;
  }
  ignoreEvent() { return false; }
}

const EMPTY_RESOURCES: MarkdownResourceMap = new Map();
const RESOURCE_RESOLUTION_DEBOUNCE_MS = 150;

const buildHiddenMarksPlugin = (
  pages: PageLinkTarget[],
  referenceOccurrences: readonly MarkdownResourceOccurrence[],
  authoritativeResources: MarkdownResourceMap | null,
) => ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.compute(view);
  }
  update(update: ViewUpdate) {
    this.decorations = this.compute(update.view);
  }
  compute(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const activeLines = new Set<number>();
    for (const range of view.state.selection.ranges) {
      const from = view.state.doc.lineAt(range.from).number;
      const to = view.state.doc.lineAt(range.to).number;
      for (let n = from; n <= to; n += 1) activeLines.add(n);
    }
    syntaxTree(view.state).iterate({
      enter: (node) => {
        const line = view.state.doc.lineAt(node.from).number;
        if (activeLines.has(line)) return;
        const name = node.name;
        // HeaderMark / EmphasisMark / QuoteMark / CodeMark etc. carry the
        // literal marker characters (##, **, >, `).
        if (name === 'HeaderMark') {
          // include the single following space so "## 标题" -> "标题" flush left
          const after = view.state.doc.sliceString(node.to, node.to + 1);
          const end = after === ' ' ? node.to + 1 : node.to;
          ranges.push(Decoration.replace({}).range(node.from, end));
          return false;
        }
        if (name === 'EmphasisMark' || name === 'CodeMark' || name === 'QuoteMark' || name === 'LinkMark' || name === 'URL') {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
          return false;
        }
        return undefined;
      },
    });
    // Wiki-links: only inspect the bounded, syntax-aware AST occurrences.
    const doc = view.state.doc;
    for (const occurrence of referenceOccurrences) {
      const { from, to } = occurrence;
      if (from < 0 || from >= to || to > doc.length || activeLines.has(doc.lineAt(from).number)) continue;
      const literal = doc.sliceString(from, to);
      if (!literal.startsWith('[[') || !literal.endsWith(']]')) continue;
      const rawReference = literal.slice(2, -2);
      const reference = parseWikiReference(rawReference);
      const referenceKey = canonicalWikiReferenceKey(reference);
      if (!reference.target || !reference.fragmentValid || referenceKey !== occurrence.reference.canonicalKey) continue;
      const resource = authoritativeResources?.get(referenceKey);
      const href = resource?.status === 'resolved' && resource.kind === 'page'
        ? resolveWikiHref(reference, [{ id: resource.pageId, title: resource.title, slug: resource.slug }])
        : authoritativeResources === null
          ? resolveWikiHref(reference, pages)
          : null;
      if (!href) continue;
      const visibleName = reference.label ?? rawReference.split('|', 1)[0].trim();
      ranges.push(
        Decoration.replace({ widget: new WikiLinkWidget(visibleName, href) })
          .range(from, to),
      );
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: (value) => value.decorations });

export const MarkdownWorkspace = forwardRef<MarkdownWorkspaceHandle, MarkdownWorkspaceProps>(({
  value,
  mode,
  onChange,
  pageId,
  spaceId,
  pages = [],
  onUploadImages,
  onUploadError,
  onSelectionChange,
  onRequestAssist,
  onRequestPageLinks,
  outlineOverlay,
  pageLinksIdentity,
}, ref) => {
  const { t, language } = useLanguage();
  const zh = language === 'zh-CN';
  const isEdit = mode === 'edit';
  const editorViewRef = useRef<EditorView | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const uploadFromPickerRef = useRef<((files: File[]) => void) | null>(null);
  const composingRef = useRef(false);
  const suppressedSlashRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<MarkdownSelection>({ from: 0, to: 0, text: '' });
  const [slash, setSlash] = useState<ReturnType<typeof slashRange>>(null);
  const [slashPosition, setSlashPosition] = useState<MenuPosition>({ top: 38, left: 12, maxHeight: 300, maxWidth: Math.max(0, window.innerWidth - 24) });
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [activeOutlineOffset, setActiveOutlineOffset] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const slashIndexRef = useRef(slashIndex);
  slashIndexRef.current = slashIndex;
  const selectionCallbackRef = useRef(onSelectionChange);
  selectionCallbackRef.current = onSelectionChange;
  const outline = useMemo(() => outlineFor(value), [value]);
  const activeHeading = outline.filter((item) => item.from <= activeOutlineOffset).slice(-1)[0]?.id ?? outline[0]?.id;
  const slashOptions = [
    { id: 'heading', en: 'Heading', zh: '标题' }, { id: 'list', en: 'List', zh: '列表' },
    { id: 'task', en: 'Task list', zh: '任务列表' }, { id: 'quote', en: 'Quote', zh: '引用' },
    { id: 'table', en: 'Table', zh: '表格' }, { id: 'code', en: 'Code block', zh: '代码块' },
    ...(onUploadImages ? [{ id: 'image', en: 'Image', zh: '图片' }] : []),
  ].filter((item) => `${item.en} ${item.zh}`.toLowerCase().includes(slash?.query.toLowerCase() ?? ''));
  const slashOptionsRef = useRef(slashOptions);
  slashOptionsRef.current = slashOptions;
  const slashKey = (view: EditorView) => `${view.state.doc.lineAt(view.state.selection.main.head).text}:${view.state.selection.main.head}`;
  const refreshSelection = useCallback((view: EditorView) => {
    const range = view.state.selection.main;
    const next = { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
    setSelection(next);
    setActiveOutlineOffset(range.from);
    selectionCallbackRef.current?.(next);
    const nextSlash = suppressedSlashRef.current === slashKey(view) ? null : slashRange(view.state, composingRef.current || view.composing);
    setSlash(nextSlash); setSlashIndex(0);

  }, []);
  useLayoutEffect(() => {
    if (!isEdit || !slash) return;
    const positionMenu = () => {
      const menu = slashMenuRef.current;
      const view = editorViewRef.current;
      if (!menu || !view) return;
      let anchor: { left: number; top: number; bottom: number } | null = null;
      try { anchor = view.coordsAtPos(slash.from); } catch { /* Hidden editors use the measured editor origin. */ }
      anchor ??= view.dom.getBoundingClientRect();
      const measured = menu.getBoundingClientRect();
      const naturalHeight = Math.max(measured.height, menu.scrollHeight + Math.max(0, menu.offsetHeight - menu.clientHeight));
      const next = menuPosition(anchor, { width: measured.width, height: naturalHeight }, { width: window.innerWidth, height: window.innerHeight });
      setSlashPosition((current) => current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight && current.maxWidth === next.maxWidth ? current : next);
    };
    positionMenu();
    document.addEventListener('scroll', positionMenu, true);
    window.addEventListener('scroll', positionMenu, { passive: true });
    window.addEventListener('resize', positionMenu);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu);
    if (slashMenuRef.current) observer?.observe(slashMenuRef.current);
    return () => {
      document.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('scroll', positionMenu);
      window.removeEventListener('resize', positionMenu);
      observer?.disconnect();
    };
  }, [isEdit, slash, slashOptions.length, language]);
  useLayoutEffect(() => {
    const menu = slashMenuRef.current;
    const option = menu?.querySelectorAll<HTMLButtonElement>('button')[slashIndex];
    if (!menu || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = Math.max(0, bottom - menu.clientHeight);
  }, [slashIndex, slash, slashPosition.maxHeight]);
  const chooseSlash = useCallback((id: string) => {
    const view = editorViewRef.current;
    const range = view && slashRange(view.state, composingRef.current || view.composing);
    if (!view || !range) return;
    if (id === 'image') { imageInputRef.current?.click(); return; }
    suppressedSlashRef.current = null;
    view.dispatch(insertionTransaction(view.state, id as InsertCommand, range.from));
    setSlash(null); view.focus();
  }, []);
  const manualHandlers = useMemo(() => Prec.highest(EditorView.domEventHandlers({
    compositionstart: () => { composingRef.current = true; setSlash(null); return false; },
    compositionend: (_event, view) => { composingRef.current = false; suppressedSlashRef.current = slashKey(view); setSlash(null); return false; },
    keydown: (event, view) => {
      if (event.isComposing || event.keyCode === 229 || composingRef.current || view.composing) return true;
      if (!slashRef.current) return false;
      const items = slashOptionsRef.current;
      if (event.key === 'Escape') { suppressedSlashRef.current = slashKey(view); setSlash(null); event.preventDefault(); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (items.length) setSlashIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        event.preventDefault(); return true;
      }
      if (event.key === 'Enter' && items.length) { chooseSlash(items[slashIndexRef.current % items.length].id); event.preventDefault(); return true; }
      return false;
    },
  })), [chooseSlash]);
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<MarkdownWorkspacePosition | null>(null);
  const selectionScope = useMemo(() => ({}), [pageId, spaceId, pageLinksIdentity]);
  // Keep full source out of positions, which may travel through browser history.
  const selectionProofsRef = useRef(new WeakMap<MarkdownSelectionBookmark, { source: string; scope: object }>());
  useLayoutEffect(() => {
    selectionProofsRef.current = new WeakMap();
    pendingRestoreRef.current = null;
  }, [selectionScope]);
  const uploadGenerationRef = useRef(0);
  const uploadOperationRef = useRef(0);
  const pendingUploadsRef = useRef<Array<() => Promise<void>>>([]);
  const uploadRunningRef = useRef(false);
  useEffect(() => {
    if (!isEdit) return;
    const update = () => {
      const view = editorViewRef.current; if (!view) return;
      const boundary = (document.querySelector<HTMLElement>('[data-testid="editor-toolbar"]')?.getBoundingClientRect().bottom ?? 88) + 12;
      let nearest = outline[0]?.from ?? 0;
      for (const heading of outline) {
        try {
          const coords = view.coordsAtPos(heading.from);
          if (coords && coords.top <= boundary) nearest = heading.from;
          else if (coords) break;
        } catch { /* Off-viewport headings are measured after they enter the view. */ }
      }
      setActiveOutlineOffset(nearest);
    };
    document.addEventListener('scroll', update, true);
    return () => document.removeEventListener('scroll', update, true);
  }, [isEdit, outline]);
  const editorResourcePlan = useMemo(() => {
    try {
      const occurrences = collectMarkdownResourceOccurrences(value);
      return {
        occurrences,
        references: [...new Map(
          occurrences.map(({ reference }) => [reference.canonicalKey, reference]),
        ).values()].sort((left, right) => (
          left.canonicalKey < right.canonicalKey ? -1 : left.canonicalKey > right.canonicalKey ? 1 : 0
        )),
      };
    } catch {
      return { occurrences: [], references: [] };
    }
  }, [value]);
  const editorReferences = editorResourcePlan.references;
  const editorReferencesRef = useRef(editorReferences);
  editorReferencesRef.current = editorReferences;
  const resolutionScopeIdentity = JSON.stringify([spaceId ?? '', pageId ?? '']);
  const referenceSetIdentity = JSON.stringify(editorReferences.map((reference) => reference.canonicalKey));
  const resolutionIdentity = `${resolutionScopeIdentity}:${referenceSetIdentity}`;
  const previousResolutionScopeRef = useRef<string | null>(null);
  const [resourceSnapshot, setResourceSnapshot] = useState<{
    identity: string;
    resources: MarkdownResourceMap;
  }>({ identity: resolutionIdentity, resources: EMPTY_RESOURCES });
  const authoritativeResources = spaceId
    ? resourceSnapshot.identity === resolutionIdentity ? resourceSnapshot.resources : EMPTY_RESOURCES
    : null;

  useEffect(() => {
    const scopeChanged = previousResolutionScopeRef.current !== resolutionScopeIdentity;
    previousResolutionScopeRef.current = resolutionScopeIdentity;
    const references = editorReferencesRef.current;
    if (!isEdit || !spaceId || references.length === 0) {
      setResourceSnapshot({ identity: resolutionIdentity, resources: EMPTY_RESOURCES });
      return;
    }
    let controller: AbortController | null = null;
    let debounceTimer: number | null = null;
    let current = true;
    setResourceSnapshot({ identity: resolutionIdentity, resources: EMPTY_RESOURCES });

    const startResolution = () => {
      controller = new AbortController();
      void resolveMarkdownResources(spaceId, references, controller.signal, pageId)
        .then((resources) => {
          if (current && !controller?.signal.aborted) {
            setResourceSnapshot({ identity: resolutionIdentity, resources });
          }
        })
        .catch(() => undefined);
    };

    if (scopeChanged) startResolution();
    else debounceTimer = window.setTimeout(startResolution, RESOURCE_RESOLUTION_DEBOUNCE_MS);
    return () => {
      current = false;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      controller?.abort();
    };
  }, [isEdit, pageId, resolutionIdentity, resolutionScopeIdentity, spaceId]);

  useLayoutEffect(() => {
    uploadGenerationRef.current += 1;
  }, [onUploadImages]);

  useLayoutEffect(() => () => {
    if (!isEdit) return;
    editorViewRef.current = null;
    uploadGenerationRef.current += 1;
  }, [isEdit]);

  const insertText = useCallback((text: string) => {
    const view = editorViewRef.current;
    if (!view || !text) return;
    insertAtSelection(view, view.state.selection, text);
    view.focus();
  }, []);

  const capturePosition = useCallback((): MarkdownWorkspacePosition => {
    if (!isEdit) {
      const root = previewRootRef.current;
      const surface = root?.closest<HTMLElement>('[data-testid="md-editor-surface"]') ?? null;
      const boundary = (document.querySelector<HTMLElement>('[data-testid="editor-toolbar"]')
        ?.getBoundingClientRect().bottom ?? 0) + 12;
      let nearest: HTMLElement | null = null;
      for (const heading of root?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []) {
        if (heading.getBoundingClientRect().top <= boundary) nearest = heading;
        else break;
      }
      const nearestBlock = nearestMarkdownSourceBlock(
        root?.querySelectorAll<HTMLElement>('[data-markdown-source-start]') ?? [],
        boundary,
      );
      return {
        cursorOffset: null,
        headingId: nearest?.id || null,
        headingText: nearest ? renderedHeadingLabel(nearest) || null : null,
        sourceOffset: markdownSourceStart(nearestBlock),
        scrollTop: surface?.scrollTop ?? window.scrollY,
      };
    }
    const view = editorViewRef.current;
    const range = view?.state.selection.main;
    const source = view?.state.doc.toString() ?? value;
    const cursorOffset = range?.head ?? 0;
    const selectionBookmark = range && !range.empty
      ? Object.freeze({ anchor: range.anchor, head: range.head })
      : undefined;
    if (selectionBookmark) selectionProofsRef.current.set(selectionBookmark, { source, scope: selectionScope });
    return {
      cursorOffset,
      headingId: null,
      headingText: nearestMarkdownHeading(source, cursorOffset),
      sourceOffset: markdownBlockSourceStart(source, cursorOffset),
      scrollTop: view?.scrollDOM.scrollTop ?? 0,
      ...(selectionBookmark ? { selectionBookmark } : {}),
    };
  }, [isEdit, selectionScope, value]);

  const restorePosition = useCallback((position: MarkdownWorkspacePosition) => {
    const candidateView = isEdit ? editorViewRef.current : null;
    const view = candidateView?.dom.isConnected ? candidateView : null;
    if (view) {
      pendingRestoreRef.current = null;
      const hasSemanticPosition = position.cursorOffset !== null
        || position.sourceOffset !== null
        || Boolean(position.headingId)
        || Boolean(position.headingText);
      const requestedOffset = position.cursorOffset
        ?? position.sourceOffset
        ?? cursorForHeading(view.state.doc.toString(), position.headingText);
      const cursorOffset = Math.min(Math.max(requestedOffset, 0), view.state.doc.length);
      const bookmark = position.selectionBookmark;
      const proof = bookmark ? selectionProofsRef.current.get(bookmark) : undefined;
      const restoredSelection = bookmark && proof?.scope === selectionScope && proof.source === view.state.doc.toString()
        ? EditorSelection.range(bookmark.anchor, bookmark.head)
        : EditorSelection.cursor(cursorOffset);
      view.dispatch({
        selection: restoredSelection,
        annotations: Transaction.addToHistory.of(false),
        effects: EditorView.scrollIntoView(restoredSelection.head, { y: 'center' }),
      });
      if (hasSemanticPosition) {
        requestAnimationFrame(() => {
          if (view.dom.isConnected) {
            view.dispatch({ effects: EditorView.scrollIntoView(restoredSelection.head, { y: 'center' }) });
          }
        });
      } else if (position.scrollTop > 0) {
        view.scrollDOM.scrollTop = position.scrollTop;
      }
      view.focus();
      return;
    }
    if (isEdit) {
      pendingRestoreRef.current = position;
      return;
    }
    pendingRestoreRef.current = null;
    const root = previewRootRef.current;
    if (!root) return;
    const sourceBlock = position.sourceOffset === null ? null : renderedBlockAtOffset(root, position.sourceOffset);
    const headingById = position.headingId ? document.getElementById(position.headingId) : null;
    const headings = root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
    const headingByText = position.headingText
      ? [...headings].find((candidate) => renderedHeadingLabel(candidate) === position.headingText) ?? null
      : null;
    const target = sourceBlock ?? (headingById && root.contains(headingById) ? headingById : null) ?? headingByText;
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
  }, [isEdit, selectionScope]);

  useImperativeHandle(ref, () => ({
    simulateChange: (next: string) => onChange(next),
    currentValue: () => editorViewRef.current?.state.doc.toString() ?? value,
    replaceDocument: (next: string) => {
      const view = editorViewRef.current;
      if (!view) return false;
      if (view.state.doc.toString() === next) return true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: [Transaction.addToHistory.of(true), isolateHistory.of('full')],
      });
      return true;
    },
    insertText,
    captureSelection: () => {
      const view = editorViewRef.current;
      const range = view?.state.selection.main;
      return range && view ? { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) } : { from: 0, to: 0, text: '' };
    },
    restoreSelection: (selection) => {
      const view = editorViewRef.current;
      if (!view || selection.from < 0 || selection.to < selection.from || selection.to > view.state.doc.length || view.state.sliceDoc(selection.from, selection.to) !== selection.text) return false;
      view.dispatch({ selection: EditorSelection.single(selection.from, selection.to) }); view.focus(); return true;
    },
    capturePosition,
    restorePosition,
  }), [capturePosition, insertText, onChange, restorePosition, value]);

  const uploadHandlers = useMemo(() => {
    uploadFromPickerRef.current = null;
    if (!isEdit || !onUploadImages) return null;

    const reportCurrentFailure = (generation: number, view: EditorView, error: unknown) => {
      if (uploadGenerationRef.current === generation && editorViewRef.current === view) onUploadError?.(error);
    };

    const removeAnchor = (view: EditorView, id: number) => {
      if (editorViewRef.current !== view) return;
      view.dispatch({ effects: removeUploadAnchor.of(id) });
    };

    const enqueue = (view: EditorView, files: File[], selection: EditorSelection) => {
      const id = ++uploadOperationRef.current;
      const generation = uploadGenerationRef.current;
      const upload = onUploadImages;
      view.dispatch({ effects: addUploadAnchor.of({ id, selection }) });

      const run = async () => {
        if (uploadGenerationRef.current !== generation || editorViewRef.current !== view) {
          removeAnchor(view, id);
          return;
        }
        try {
          const names = await upload(files);
          if (uploadGenerationRef.current !== generation || editorViewRef.current !== view) {
            removeAnchor(view, id);
            return;
          }
          if (
            !Array.isArray(names)
            || names.length !== files.length
            || names.some((name) => typeof name !== 'string' || !name.trim())
          ) throw new Error('Invalid image upload result');
          const anchor = view.state.field(uploadAnchors).get(id);
          if (!anchor) throw new Error('Image upload position is no longer available');
          const markers = names.map(formatAttachmentReference).join('\n');
          insertUploadedText(view, id, anchor, markers);
          view.focus();
        } catch (error) {
          removeAnchor(view, id);
          reportCurrentFailure(generation, view, error);
        }
      };

      const drain = () => {
        if (uploadRunningRef.current) return;
        const next = pendingUploadsRef.current.shift();
        if (!next) return;
        uploadRunningRef.current = true;
        void next()
          .catch(() => undefined)
          .finally(() => {
            uploadRunningRef.current = false;
            drain();
          });
      };
      pendingUploadsRef.current.push(run);
      drain();
    };

    const handleAccepted = (
      view: EditorView,
      event: ClipboardEvent | DragEvent,
      selection: EditorSelection | null,
    ) => {
      const files = imageFilesFromTransfer(
        'clipboardData' in event ? event.clipboardData : event.dataTransfer,
      );
      if (files.length === 0) return false;
      event.preventDefault();
      if (!selection) {
        onUploadError?.(new Error('Image drop position is not available'));
        return true;
      }
      enqueue(view, files, selection);
      return true;
    };

    uploadFromPickerRef.current = (files) => {
      const view = editorViewRef.current;
      if (view && files.length) enqueue(view, files.filter((file) => acceptedImageFile(file)), uploadSelection(view.state.selection));
    };
    return EditorView.domEventHandlers({
      paste: (event, view) => handleAccepted(view, event, uploadSelection(view.state.selection)),
      dragover: (event) => {
        if (imageFilesFromTransfer(event.dataTransfer).length === 0) return false;
        event.preventDefault();
        return true;
      },
      drop: (event, view) => {
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        return handleAccepted(view, event, position === null
          ? null
          : EditorSelection.create([EditorSelection.cursor(position, 1)]));
      },
    });
  }, [isEdit, onUploadError, onUploadImages]);

  return (
    <section className="document-workspace relative bg-white" aria-label={t('editor.mode')}>
      <div className="document-tool-row">
        {isEdit ? <DocumentTools key={`${pageLinksIdentity ?? ''}:${spaceId}:${pageId}`} view={() => editorViewRef.current} selection={selection} pages={pages} spaceId={spaceId} onRequestPageLinks={onRequestPageLinks} onRequestAssist={onRequestAssist} onRequestImage={onUploadImages ? () => imageInputRef.current?.click() : undefined} /> : null}
        <ArticleContentsPopover source={value} articleRootRef={previewRootRef} pageKey={`${spaceId}:${pageId}:${mode}`} activeHeadingId={isEdit ? activeHeading : undefined} spaceId={spaceId} suppressed={outlineOverlay} onNavigate={isEdit ? (item) => {
          const view = editorViewRef.current; if (!view) return;
          view.dispatch({ selection: EditorSelection.cursor(item.from), effects: EditorView.scrollIntoView(item.from, { y: 'start' }) }); view.focus();
        } : undefined} />
      </div>
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label={zh ? '上传图片' : 'Upload images'} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        const view = editorViewRef.current;
        const range = view && slashRange(view.state, composingRef.current || view.composing);
        if (view && range && files.length) {
          view.dispatch({ selection: EditorSelection.single(range.from, range.to) });
        }
        uploadFromPickerRef.current?.(files); event.target.value = ''; setSlash(null);
      }} />
      {isEdit && slash ? createPortal(<div ref={slashMenuRef} role="menu" aria-label={zh ? '插入块' : 'Insert block'} className="document-slash-menu" style={slashPosition} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { const view = editorViewRef.current; if (view) { suppressedSlashRef.current = slashKey(view); view.focus(); } setSlash(null); event.preventDefault(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const next = (slashIndex + (event.key === 'ArrowDown' ? 1 : -1) + slashOptions.length) % Math.max(1, slashOptions.length);
          setSlashIndex(next); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus(); event.preventDefault();
        }
      }}>
        {slashOptions.map((item, index) => <button type="button" role="menuitem" key={item.id} aria-current={index === slashIndex ? 'true' : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSlash(item.id)}>{zh ? item.zh : item.en}</button>)}
        {!slashOptions.length ? <p>{zh ? '没有匹配的插入项' : 'No matching blocks'}</p> : null}
      </div>, document.body) : null}
      <div
        data-testid="md-editor-surface"
        className="document-body-surface min-h-[480px] bg-white"
        aria-label={isEdit ? t('editor.editMode') : t('editor.previewMode')}
      >
        {isEdit ? (
          <CodeMirror
            value={value}
            onChange={(next) => onChange(next)}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
              uploadGenerationRef.current += 1;
              refreshSelection(view);
              const pendingPosition = pendingRestoreRef.current;
              if (pendingPosition) restorePosition(pendingPosition);
            }}
            onUpdate={(update) => { if (update.selectionSet || update.docChanged) refreshSelection(update.view); }}
            extensions={[
              markdown({ base: markdownLanguage, codeLanguages: languages }),
              syntaxHighlighting(livePreviewStyle),
              buildHiddenMarksPlugin(pages, editorResourcePlan.occurrences, authoritativeResources),
              uploadAnchors,
              manualHandlers,
              ...(uploadHandlers ? [uploadHandlers] : []),
              EditorView.lineWrapping,
            ]}
            placeholder={t('editor.placeholder')}
            aria-label={t('editor.editMode')}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
            }}
            className="document-source-editor"
          />
        ) : (
          <div ref={previewRootRef} className="document-body" data-testid="md-preview">
            <div>
              {value ? (
                <Markdown
                  mode="editor-preview"
                  className="document-body"
                  canEdit
                  pageId={pageId}
                  spaceId={spaceId}
                  onTaskToggle={({ task, nextChecked }) => {
                    const next = toggleMarkdownTask(value, task, nextChecked);
                    if (next !== null) onChange(next);
                  }}
                  pages={pages}
                >
                  {value}
                </Markdown>
              ) : (
                <p className="py-12 text-center text-sm text-gray-400">{t('editor.emptyPreview')}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
});
MarkdownWorkspace.displayName = 'MarkdownWorkspace';
