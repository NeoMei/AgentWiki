import { WidgetType } from '@codemirror/view';
import { fetchAttachmentBlob } from '../../features/attachments/attachmentApi';

// CodeMirror can remount a widget or transfer its DOM to an equal instance.
// Resource ownership therefore follows the DOM, rather than the widget instance.
const imageResources = new WeakMap<HTMLElement, { controller: AbortController; objectUrl: string | null }>();

export class AttachmentImageWidget extends WidgetType {
  constructor(
    readonly attachmentId: string,
    readonly displayName: string,
    readonly width: number,
    readonly height: number,
    readonly alt: string,
  ) { super(); }

  eq(other: AttachmentImageWidget) {
    return other.attachmentId === this.attachmentId
      && other.displayName === this.displayName
      && other.width === this.width
      && other.height === this.height
      && other.alt === this.alt;
  }

  toDOM() {
    const image = document.createElement('img');
    image.alt = this.alt || this.displayName;
    image.width = this.width;
    image.height = this.height;
    image.className = 'cm-md-attachment-image';
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
    image.dataset.attachmentId = this.attachmentId;
    const resource = { controller: new AbortController(), objectUrl: null as string | null };
    imageResources.set(image, resource);
    void fetchAttachmentBlob(this.attachmentId, resource.controller.signal).then((blob) => {
      if (resource.controller.signal.aborted) return;
      resource.objectUrl = URL.createObjectURL(blob);
      image.src = resource.objectUrl;
    }).catch(() => { /* The original alt text remains available on load failure. */ });
    return image;
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
