import {
  foldCase,
  validatePortableDirectoryPath,
} from '@neomei/agentwiki-sync-protocol';
import { ContentTreeError } from './content-tree.types';
import { normalizeFolderName } from './folder-name';

describe('normalizeFolderName', () => {
  it('trims only surrounding whitespace, normalizes NFC, and returns the portable key and byte count', () => {
    const result = normalizeFolderName('  Cafe\u0301 2026  ');

    expect(result).toEqual({
      name: 'Café 2026',
      nameKey: foldCase('Café 2026'),
      byteLength: new TextEncoder().encode('Café 2026').byteLength,
    });
  });

  it.each([
    '',
    '   ',
    'CON',
    'aux.txt',
    'bad/name',
    'bad\\name',
    'bad:name',
    'trailing.',
    'control\u0007',
  ])('rejects the portable-invalid name %p', (name) => {
    expect(() => normalizeFolderName(name)).toThrow(ContentTreeError);
  });

  it('distinguishes invalid names from byte-limit failures', () => {
    try {
      normalizeFolderName('😀'.repeat(64));
      throw new Error('expected normalizeFolderName to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentTreeError);
      expect((error as ContentTreeError).code).toBe('FOLDER_PATH_TOO_LONG');
    }
  });

  it('enforces the 200-code-point visible-name limit', () => {
    expect(normalizeFolderName('a'.repeat(200)).name).toHaveLength(200);
    expect(() => normalizeFolderName('a'.repeat(201))).toThrow(
      expect.objectContaining({ code: 'FOLDER_INVALID_NAME' }),
    );
  });

  it('agrees with Sync Protocol directory validation for generated Unicode names', () => {
    const alphabet = ['a', 'Z', 'é', 'e\u0301', '项', '目', '🌱', 'Ω', 'ω', 'İ', 'ß', ' '];
    let state = 0x6d2b79f5;
    const next = () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0);
    };

    for (let sample = 0; sample < 500; sample += 1) {
      const length = 1 + (next() % 30);
      let generated = '';
      for (let index = 0; index < length; index += 1) {
        generated += alphabet[next() % alphabet.length];
      }
      const raw = `  ${generated.trim() || 'x'}  `;
      const normalized = normalizeFolderName(raw);
      const portable = validatePortableDirectoryPath(`pages/${normalized.name}`);

      expect(normalized.nameKey).toBe(foldCase(normalized.name));
      expect(portable.key).toBe(`pages/${normalized.nameKey}`);
      expect(portable.path).toBe(`pages/${normalized.name}`);
      expect(normalized.byteLength).toBe(new TextEncoder().encode(normalized.name).byteLength);
    }
  });
});
