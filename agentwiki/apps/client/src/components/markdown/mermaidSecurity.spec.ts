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
    ['mixed-case xlink URL', 'xlink:HrEf="https://evil.test/path"'],
    ['encoded xlink javascript URL', 'xlink:href="java&#x73;cript:alert(1)"'],
  ])('strips %s from every href namespace and casing', (_label, attribute) => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a ${attribute}><text>bad</text></a><a href="#safe"><text>safe</text></a></svg>`;
    const clean = sanitizeMermaidSvg(dirty);

    expect(clean).not.toMatch(/evil\.test|javascript:|xlink:href/iu);
    expect(clean).toContain('href="#safe"');
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
