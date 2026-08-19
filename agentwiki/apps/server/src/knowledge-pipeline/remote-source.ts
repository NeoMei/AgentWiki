const decodeEntities = (value: string) => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));

export function extractHtmlText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const structured = withoutNoise
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<(br|hr)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|main|nav|ul|ol|table|tr|blockquote)\s*>/gi, '\n')
    .replace(/<(p|div|section|article|header|footer|main|nav|ul|ol|table|tr|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(structured)
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isSupportedTextContentType(value: string): boolean {
  const type = value.split(';', 1)[0].trim().toLowerCase();
  return type.startsWith('text/') || type === 'application/json' || type === 'application/xml' ||
    type.endsWith('+json') || type.endsWith('+xml');
}
