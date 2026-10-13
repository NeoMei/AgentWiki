import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAttachmentBlob } from '../../features/attachments/attachmentApi';
import { AttachmentImageWidget } from './AttachmentImageWidget';

vi.mock('../../features/attachments/attachmentApi', () => ({ fetchAttachmentBlob: vi.fn() }));

const widget = () => new AttachmentImageWidget('attachment-1', 'image.png', 300, 200, 'image.png');
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('AttachmentImageWidget lifecycle', () => {
  beforeEach(() => {
    vi.mocked(fetchAttachmentBlob).mockReset();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:editor-image'),
      revokeObjectURL: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reloads an image when the same decoration leaves and re-enters the viewport', async () => {
    vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['image']));
    const instance = widget();
    const first = instance.toDOM();
    await settle();
    expect(first.getAttribute('src')).toBe('blob:editor-image');
    instance.destroy(first);
    const second = instance.toDOM();
    await settle();
    expect(vi.mocked(fetchAttachmentBlob).mock.calls[1][1]?.aborted).toBe(false);
    expect(second.getAttribute('src')).toBe('blob:editor-image');
    instance.destroy(second);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('releases a reused DOM node when CodeMirror replaces its widget with an equal instance', async () => {
    vi.mocked(fetchAttachmentBlob).mockResolvedValue(new Blob(['image']));
    const original = widget();
    const dom = original.toDOM();
    const signal = vi.mocked(fetchAttachmentBlob).mock.calls[0][1];
    await settle();
    const replacement = widget();
    expect(replacement.eq(original)).toBe(true);
    replacement.destroy(dom);
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-image');
  });

  it('does not create a blob URL for a request resolved after its DOM node is destroyed', async () => {
    let resolve!: (blob: Blob) => void;
    vi.mocked(fetchAttachmentBlob).mockReturnValue(new Promise((done) => { resolve = done; }));
    const dom = widget().toDOM();
    widget().destroy(dom);
    resolve(new Blob(['image']));
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(dom.hasAttribute('src')).toBe(false);
  });
});
