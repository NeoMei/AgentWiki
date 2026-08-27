import { describe, expect, it } from 'vitest';
import { canonicalWikiReferenceKey, parseWikiReference } from './obsidian';

describe('parseWikiReference', () => {
  it('parses an aliased page reference', () => {
    expect(parseWikiReference('Page|Shown')).toEqual({
      embed: false, target: 'Page', label: 'Shown', heading: null, blockId: null,
      fragmentPresent: false, fragmentKind: null, fragmentValid: true,
    });
  });

  it('parses a heading reference', () => {
    expect(parseWikiReference('Page#Heading')).toEqual({
      embed: false, target: 'Page', label: null, heading: 'Heading', blockId: null,
      fragmentPresent: true, fragmentKind: 'heading', fragmentValid: true,
    });
  });

  it('parses a block reference', () => {
    expect(parseWikiReference('Page#^block-1')).toEqual({
      embed: false, target: 'Page', label: null, heading: null, blockId: 'block-1',
      fragmentPresent: true, fragmentKind: 'block', fragmentValid: true,
    });
  });

  it.each([
    ['!Page#^|Alias', 'Page', 'Alias'],
    ['!image.png#^|Picture', 'image.png', 'Picture'],
  ])('preserves an empty block-fragment intent in %s', (raw, target, label) => {
    expect(parseWikiReference(raw)).toEqual(expect.objectContaining({
      embed: true,
      target,
      label,
      heading: null,
      blockId: null,
      fragmentPresent: true,
      fragmentKind: 'block',
      fragmentValid: false,
    }));
  });
});

describe('canonicalWikiReferenceKey', () => {
  it('uses Unicode 15.1 full case folding for page targets and fragments', () => {
    expect(canonicalWikiReferenceKey(parseWikiReference('Straße#ΟΣ'))).toBe(
      canonicalWikiReferenceKey(parseWikiReference('STRASSE#οσ')),
    );
    expect(canonicalWikiReferenceKey(parseWikiReference('Page#^Straße'))).toBe(
      canonicalWikiReferenceKey(parseWikiReference('PAGE#^STRASSE')),
    );
  });

  it('keeps attachment target identity on the stored attachment-name rule', () => {
    expect(canonicalWikiReferenceKey(parseWikiReference('!Straße.png'))).not.toBe(
      canonicalWikiReferenceKey(parseWikiReference('!STRASSE.png')),
    );
  });
});
