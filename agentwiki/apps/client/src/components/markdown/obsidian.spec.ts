import { describe, expect, it } from 'vitest';
import { parseWikiReference } from './obsidian';

describe('parseWikiReference', () => {
  it('parses an aliased page reference', () => {
    expect(parseWikiReference('Page|Shown')).toEqual({
      embed: false, target: 'Page', label: 'Shown', heading: null, blockId: null,
    });
  });

  it('parses a heading reference', () => {
    expect(parseWikiReference('Page#Heading')).toEqual({
      embed: false, target: 'Page', label: null, heading: 'Heading', blockId: null,
    });
  });

  it('parses a block reference', () => {
    expect(parseWikiReference('Page#^block-1')).toEqual({
      embed: false, target: 'Page', label: null, heading: null, blockId: 'block-1',
    });
  });
});
