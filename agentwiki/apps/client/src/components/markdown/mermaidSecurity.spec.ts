import { describe, expect, it } from 'vitest';
import { MAX_MERMAID_SOURCE_CHARS, sanitizeMermaidSvg } from './mermaidSecurity';

describe('sanitizeMermaidSvg', () => {
  it('exports the reviewed Mermaid source limit', () => {
    expect(MAX_MERMAID_SOURCE_CHARS).toBe(20_000);
  });

  it('removes executable elements and event handlers while preserving a local fragment', () => {
    const dirty = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<script>alert(1)</script>',
      '<foreignObject><div>html</div></foreignObject>',
      '<iframe/><object/><embed/><audio/>',
      '<a href="javascript:alert(1)" onclick="alert(2)"><text>bad</text></a>',
      '<a href="#local"><text>ok</text></a>',
      '</svg>',
    ].join('');

    const clean = sanitizeMermaidSvg(dirty);

    expect(clean).not.toMatch(/script|foreignObject|iframe|object|embed|audio|onclick|javascript:/iu);
    expect(clean).toContain('href="#local"');
  });

  it.each([
    ['mixed-case external URL', 'HrEf="HTTPS://evil.test/path"'],
    ['protocol-relative URL', 'href="//evil.test/path"'],
    ['encoded javascript URL', 'href="&#x6a;avascript:alert(1)"'],
    ['encoded xlink javascript URL', 'xlink:href="java&#x73;cript:alert(1)"'],
  ])('strips %s from every href namespace and casing', (_label, attribute) => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a ${attribute}><text>bad</text></a><a href="#safe"><text>safe</text></a></svg>`;
    const clean = sanitizeMermaidSvg(dirty);

    expect(clean).not.toMatch(/evil\.test|javascript:|xlink:href/iu);
    expect(clean).toContain('href="#safe"');
  });

  it('sanitizes Mermaid click output that omits the xlink namespace declaration', () => {
    const dirty = [
      '<svg id="diagram" xmlns="http://www.w3.org/2000/svg">',
      '<a xlink:href="https://evil.test/click"><text>safe label</text></a>',
      '</svg>',
    ].join('');

    const clean = sanitizeMermaidSvg(dirty);

    expect(clean).toContain('<text>safe label</text>');
    expect(clean).not.toMatch(/evil\.test|xlink:href/iu);
  });

  it('accepts an exact standard root XLink declaration and strips its external href', () => {
    const clean = sanitizeMermaidSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
      '<a xlink:href="https://evil.test/click"><text>safe label</text></a>',
      '</svg>',
    ].join(''));

    expect(clean).toContain('<text>safe label</text>');
    expect(clean).not.toMatch(/evil\.test|xlink:href/iu);
  });

  it.each([
    ['a spoofed root declaration', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="https://evil.test/xlink"><a xlink:href="#target"/></svg>'],
    ['a duplicate standard root declaration', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink"><text>bad</text></svg>'],
    ['conflicting root declarations', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xlink="https://evil.test/xlink"><text>bad</text></svg>'],
    ['a spoofed nested declaration', '<svg xmlns="http://www.w3.org/2000/svg"><g xmlns:xlink="https://evil.test/xlink"><a xlink:href="#target"/></g></svg>'],
  ])('fails closed for %s', (_label, dirty) => {
    expect(() => sanitizeMermaidSvg(dirty)).toThrow('MERMAID_SVG_INVALID');
  });

  it('respects a standard nested declaration without treating it as a root declaration', () => {
    const clean = sanitizeMermaidSvg([
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<g xmlns:xlink="http://www.w3.org/1999/xlink">',
      '<a xlink:href="https://evil.test/click"><text>nested label</text></a>',
      '</g>',
      '</svg>',
    ].join(''));

    expect(clean).toContain('<text>nested label</text>');
    expect(clean).not.toMatch(/evil\.test|xlink:href/iu);
  });

  it.each([
    ['root attribute text', 'data-note="decoy xmlns:xlink = &quot;not-a-declaration&quot;"'],
    ['comment text', '', '<!-- decoy xmlns:xlink = "not-a-declaration" -->'],
    ['element text', '', '<text>decoy xmlns:xlink = "not-a-declaration"</text>'],
    ['style text', '', '<style>/* decoy xmlns:xlink = "not-a-declaration" */</style>'],
  ])('ignores %s while repairing a real undeclared xlink:href', (_label, rootAttribute, decoy = '') => {
    const clean = sanitizeMermaidSvg([
      `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttribute}>`,
      decoy,
      '<a xlink:href="https://evil.test/click"><text>safe label</text></a>',
      '</svg>',
    ].join(''));

    expect(clean).toContain('<text>safe label</text>');
    expect(clean).not.toMatch(/evil\.test|xlink:href/iu);
  });

  it('repairs exact xlink:href with XML whitespace around equals', () => {
    const clean = sanitizeMermaidSvg([
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<a xlink:href \n\t = \r "https://evil.test/click"><text>safe label</text></a>',
      '</svg>',
    ].join(''));

    expect(clean).toContain('<text>safe label</text>');
    expect(clean).not.toMatch(/evil\.test|xlink:href/iu);
  });

  it('repairs multiple case-exact xlink:href attributes with XML whitespace', () => {
    const clean = sanitizeMermaidSvg([
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<a xlink:href\n = "#first"><text>first</text></a>',
      '<a xlink:href\t=\r"#second"><text>second</text></a>',
      '</svg>',
    ].join(''));

    expect(clean).toContain('<text>first</text>');
    expect(clean).toContain('<text>second</text>');
  });

  it.each([
    [
      'an xlink-prefixed element beside a real missing-namespace href',
      '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="#safe"/><xlink:foo/></svg>',
    ],
    [
      'another xlink-prefixed attribute beside a real missing-namespace href',
      '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="#safe" xlink:other="value"/></svg>',
    ],
    [
      'an xlink-prefixed element with a standard declaration',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="#safe"/><xlink:foo/></svg>',
    ],
    [
      'another xlink-prefixed attribute with a standard declaration',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="#safe" xlink:other="value"/></svg>',
    ],
    [
      'a case-variant xlink-prefixed attribute with a standard declaration',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="#safe" xlink:HrEf="value"/></svg>',
    ],
  ])('fails closed for %s', (_label, dirty) => {
    expect(() => sanitizeMermaidSvg(dirty)).toThrow('MERMAID_SVG_INVALID');
  });

  it.each([
    ['local-name case variant', 'xlink:Href'],
    ['prefix case variant', 'XLINK:href'],
  ])('does not repair an undeclared %s', (_label, attributeName) => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a ${attributeName}="https://evil.test/click"/></svg>`;
    expect(() => sanitizeMermaidSvg(dirty)).toThrow('MERMAID_SVG_INVALID');
  });

  it('does not let a decoy repair a malformed root', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><!-- xlink:href="https://evil.test" --><g></svg>';
    expect(() => sanitizeMermaidSvg(dirty)).toThrow('MERMAID_SVG_INVALID');
  });

  it('strips a non-fragment href from the SVG root itself', () => {
    const clean = sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg" href="/relative/root"><text>safe</text></svg>');

    expect(clean).not.toContain('/relative/root');
    expect(clean).toContain('<text>safe</text>');
  });

  it('removes external CSS resources and unscoped rules while preserving local SVG references', () => {
    const dirty = [
      '<svg id="diagram" xmlns="http://www.w3.org/2000/svg">',
      '<defs><linearGradient id="local"><stop offset="1"/></linearGradient></defs>',
      '<style>@keyframes dash{to{stroke-dashoffset:0}}#diagram .safe{fill:url(#local);animation:dash 1s}</style>',
      '<style>@import url(https://evil.test/import.css);#diagram .bad{fill:red}</style>',
      '<style>body{display:none}</style>',
      '<style>#diagram:not(.never) + #outside{display:none}</style>',
      '<rect class="safe" fill="url(#local)"/>',
      '<rect class="bad" fill="url(https://evil.test/fill.svg)" style="filter:url(data:image/svg+xml,bad)"/>',
      '<circle cursor="url(blob:https://evil.test/cursor)" stroke="url(//evil.test/stroke.svg)"/>',
      '<path style="fill:url(javascript:alert(1))"/>',
      '</svg>',
    ].join('');

    const clean = sanitizeMermaidSvg(dirty);

    expect(clean).toContain('@keyframes dash{to{stroke-dashoffset:0}}');
    expect(clean).toContain('#diagram .safe{fill:url(#local);animation:dash 1s}');
    expect(clean).toContain('fill="url(#local)"');
    expect(clean).not.toMatch(/evil\.test|data:|blob:|javascript:|@import|body\s*\{|#outside/iu);
  });

  it('fails closed for ambiguous or escaped CSS URL syntax', () => {
    const dirty = [
      '<svg id="diagram" xmlns="http://www.w3.org/2000/svg">',
      '<style>#diagram .comment{fill:u/**/rl(https://evil.test/comment.svg)}</style>',
      '<style>#diagram .escape{fill:u\\72l(https://evil.test/escape.svg)}</style>',
      '<rect style="background-image:image-set(&quot;https://evil.test/image.png&quot;)"/>',
      '<circle filter="u\\72l(//evil.test/filter.svg)"/>',
      '</svg>',
    ].join('');

    const clean = sanitizeMermaidSvg(dirty);

    expect(clean).not.toMatch(/evil\.test|image-set|u\\72l|\/\*\*\//iu);
  });

  it('rejects empty, malformed, and non-svg roots', () => {
    expect(() => sanitizeMermaidSvg('')).toThrow('MERMAID_SVG_INVALID');
    expect(() => sanitizeMermaidSvg('<svg><g></svg>')).toThrow('MERMAID_SVG_INVALID');
    expect(() => sanitizeMermaidSvg('<svg xmlns="https://evil.test/not-svg" />')).toThrow('MERMAID_SVG_INVALID');
    expect(() => sanitizeMermaidSvg('<div><svg /></div>')).toThrow('MERMAID_SVG_INVALID');
  });
});
