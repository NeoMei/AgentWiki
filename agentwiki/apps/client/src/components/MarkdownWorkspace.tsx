import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { ChangeDesc, EditorSelection, Range, StateEffect, StateField } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { syntaxTree } from '@codemirror/language';
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
}

export interface MarkdownWorkspaceHandle {
  /** Test hook: drive a content change as if the user typed it. */
  simulateChange: (next: string) => void;
  currentValue: () => string;
  insertText: (text: string) => void;
}

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
}, ref) => {
  const { t } = useLanguage();
  const isEdit = mode === 'edit';
  const editorViewRef = useRef<EditorView | null>(null);
  const uploadGenerationRef = useRef(0);
  const uploadOperationRef = useRef(0);
  const pendingUploadsRef = useRef<Array<() => Promise<void>>>([]);
  const uploadRunningRef = useRef(false);
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
      void resolveMarkdownResources(spaceId, references, controller.signal)
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
  }, [isEdit, resolutionIdentity, resolutionScopeIdentity, spaceId]);

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

  useImperativeHandle(ref, () => ({
    simulateChange: (next: string) => onChange(next),
    currentValue: () => editorViewRef.current?.state.doc.toString() ?? value,
    insertText,
  }), [insertText, onChange, value]);

  const uploadHandlers = useMemo(() => {
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
          const markers = names.map((name) => `![[${name}]]`).join('\n');
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
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={t('editor.mode')}>
      <div
        data-testid="md-editor-surface"
        className="h-[calc(100vh-245px)] min-h-[480px] overflow-auto bg-white"
        aria-label={isEdit ? t('editor.editMode') : t('editor.previewMode')}
      >
        {isEdit ? (
          <CodeMirror
            value={value}
            onChange={(next) => onChange(next)}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
              uploadGenerationRef.current += 1;
            }}
            extensions={[
              markdown({ base: markdownLanguage, codeLanguages: languages }),
              syntaxHighlighting(livePreviewStyle),
              buildHiddenMarksPlugin(pages, editorResourcePlan.occurrences, authoritativeResources),
              uploadAnchors,
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
            className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:leading-7 [&_.cm-scroller]:text-[15px] [&_.cm-scroller]:text-gray-800 [&_.cm-content]:mx-auto [&_.cm-content]:max-w-4xl [&_.cm-content]:px-6 [&_.cm-content]:py-6 [&_.cm-content]:md:px-10 [&_.cm-content]:md:py-8"
          />
        ) : (
          <div className="px-6 py-6 md:px-10 md:py-8" data-testid="md-preview">
            <div className="mx-auto max-w-4xl">
              {value ? (
                <Markdown
                  mode="editor-preview"
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
