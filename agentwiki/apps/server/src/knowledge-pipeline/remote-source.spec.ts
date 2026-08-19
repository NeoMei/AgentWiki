import { extractHtmlText, isSupportedTextContentType } from './remote-source';

describe('remote source extraction', () => {
  it('extracts readable headings, paragraphs, lists and links without scripts', () => {
    const text = extractHtmlText(`
      <html><head><title>Tesla</title><style>.x{}</style></head>
      <body><h1>特斯拉</h1><p>电动车公司</p><ul><li><a href="/models">车型</a></li></ul><script>alert(1)</script></body></html>
    `);
    expect(text).toContain('# 特斯拉');
    expect(text).toContain('电动车公司');
    expect(text).toContain('- 车型');
    expect(text).not.toContain('alert(1)');
  });

  it('accepts text and JSON but rejects binary media', () => {
    expect(isSupportedTextContentType('text/html; charset=utf-8')).toBe(true);
    expect(isSupportedTextContentType('application/json')).toBe(true);
    expect(isSupportedTextContentType('image/png')).toBe(false);
  });
});
