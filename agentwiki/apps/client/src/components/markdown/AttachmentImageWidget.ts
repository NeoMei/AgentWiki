import { EditorView, WidgetType } from '@codemirror/view';
import { fetchAttachmentBlob } from '../../features/attachments/attachmentApi';
import { isExternalHttpsImage } from './imageSource';

// CodeMirror can transfer DOM to an equal widget. Resource ownership follows
// the DOM so viewport remounts and decoration replacements release it once.
const imageResources = new WeakMap<HTMLElement, { controller: AbortController; objectUrl: string | null }>();

type ImageSource = { url: string } | { attachmentId: string; width: number; height: number };

export class MarkdownImageWidget extends WidgetType {
  constructor(
    readonly source: ImageSource,
    readonly alt: string,
    readonly sourceOffset = 2,
    readonly editLabel = 'Edit image',
    readonly unavailableLabel = 'Image unavailable',
    readonly title: string | null = null,
  ) { super(); }

  eq(other: MarkdownImageWidget) {
    return JSON.stringify(other.source) === JSON.stringify(this.source)
      && other.alt === this.alt && other.sourceOffset === this.sourceOffset
      && other.editLabel === this.editLabel && other.unavailableLabel === this.unavailableLabel
      && other.title === this.title;
  }

  toDOM(view?: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-md-image-preview';
    button.setAttribute('aria-label', `${this.editLabel}${this.alt ? `: ${this.alt}` : ''}`);
    button.title = this.editLabel;
    const image = document.createElement('img');
    image.alt = this.alt;
    image.className = 'cm-md-attachment-image';
    if (this.title) image.title = this.title;
    image.draggable = false;
    const resource = { controller: new AbortController(), objectUrl: null as string | null };
    imageResources.set(button, resource);
    const unavailable = () => {
      if (resource.controller.signal.aborted) return;
      const fallback = document.createElement('span');
      fallback.className = 'cm-md-image-fallback';
      fallback.textContent = `${this.unavailableLabel}${this.alt ? `: ${this.alt}` : ''}`;
      button.replaceChildren(fallback);
      view?.requestMeasure();
    };
    image.addEventListener('error', unavailable);
    image.addEventListener('load', () => view?.requestMeasure());
    button.append(image);
    if ('attachmentId' in this.source) {
      image.width = this.source.width;
      image.height = this.source.height;
      image.dataset.attachmentId = this.source.attachmentId;
      void fetchAttachmentBlob(this.source.attachmentId, resource.controller.signal).then((blob) => {
        if (resource.controller.signal.aborted) return;
        resource.objectUrl = URL.createObjectURL(blob);
        image.src = resource.objectUrl;
      }).catch(unavailable);
    } else {
      if (isExternalHttpsImage(this.source.url)) {
        image.setAttribute('referrerpolicy', 'no-referrer');
        image.loading = 'lazy';
        image.decoding = 'async';
      }
      image.src = this.source.url;
    }
    const reveal = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!view) return;
      // Resolve against current DOM, not the document offset at widget creation.
      const from = view.posAtDOM(button);
      view.focus();
      view.dispatch({ selection: { anchor: from + this.sourceOffset }, scrollIntoView: true });
    };
    // Do not let the browser focus the button and collapse the editor's selection
    // before the click handler obtains this widget's current source position.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', reveal);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') reveal(event);
    });
    return button;
  }

  destroy(dom: HTMLElement) {
    const resource = imageResources.get(dom);
    if (!resource) return;
    resource.controller.abort();
    if (resource.objectUrl) URL.revokeObjectURL(resource.objectUrl);
    imageResources.delete(dom);
  }

  ignoreEvent() { return true; }
}

export class AttachmentImageWidget extends MarkdownImageWidget {
  constructor(
    attachmentId: string,
    displayName: string,
    width: number,
    height: number,
    alt: string,
    sourceOffset = 3,
    editLabel = 'Edit image',
    unavailableLabel = 'Image unavailable',
    title: string | null = null,
  ) {
    super({ attachmentId, width, height }, alt || displayName, sourceOffset, editLabel, unavailableLabel, title);
  }
}
