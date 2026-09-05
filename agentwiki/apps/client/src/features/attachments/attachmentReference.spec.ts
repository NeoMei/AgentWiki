import { describe, expect, it } from 'vitest';
import { formatAttachmentReference } from './attachmentReference';

describe('formatAttachmentReference', () => {
  it('formats only an authoritative managed canonical path', () => {
    expect(formatAttachmentReference('assets/图 表(1).png')).toBe('![[assets/图 表(1).png]]');
  });

  it.each([null, '', 'diagram.png', 'assets/bad|name.png', 'assets/a%20b.png'])(
    'fails closed instead of manufacturing a marker from %p', (canonicalPath) => {
    expect(() => formatAttachmentReference(canonicalPath)).toThrow('not referenceable');
    },
  );
});
