import DOMPurify from 'dompurify';

export const MAX_MERMAID_SOURCE_CHARS = 20_000;

const INVALID_SVG_ERROR = 'MERMAID_SVG_INVALID';
const FORBIDDEN_SVG_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'audio',
] as const;

const CSS_VALUE_ATTRIBUTES = new Set([
  'clip-path',
  'color-profile',
  'cursor',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
  'style',
]);

const CSS_AMBIGUOUS_SYNTAX = /\\|\/\*/u;
const CSS_EXTERNAL_TOKEN = /(?:https?|data|blob|javascript|file|ftp):|\/\/|(?:^|[^a-z-])(?:-webkit-)?image-set\s*\(|(?:^|[^a-z-])src\s*\(|(?:^|[;{])\s*(?:behavior|-moz-binding)\s*:/iu;
const CSS_URL_START = /url\s*\(/iu;
const CSS_URL = /url\s*\(([^)]*)\)/giu;
const SAFE_SVG_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/u;
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XML_WHITESPACE = /[\t\n\r ]/u;

const hasUnsafeControlCharacter = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13)
    || codePoint === 127;
});

const hasAmbiguousCssSyntax = (value: string) => CSS_AMBIGUOUS_SYNTAX.test(value)
  || hasUnsafeControlCharacter(value);

const parseSvg = (svg: string) => {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (
    root.localName.toLowerCase() !== 'svg'
    || root.namespaceURI !== 'http://www.w3.org/2000/svg'
    || document.querySelector('parsererror') !== null
  ) {
    throw new Error(INVALID_SVG_ERROR);
  }
  return { document, root };
};

const inspectLexicalSvgRoot = (svg: string) => {
  let cursor = 0;
  while (XML_WHITESPACE.test(svg[cursor] ?? '')) cursor += 1;
  if (!svg.startsWith('<svg', cursor)) throw new Error(INVALID_SVG_ERROR);

  const insertAt = cursor + '<svg'.length;
  const afterName = svg[insertAt] ?? '';
  if (afterName !== '>' && afterName !== '/' && !XML_WHITESPACE.test(afterName)) {
    throw new Error(INVALID_SVG_ERROR);
  }

  const xlinkDeclarations: string[] = [];
  cursor = insertAt;
  while (cursor < svg.length) {
    while (XML_WHITESPACE.test(svg[cursor] ?? '')) cursor += 1;
    if (svg[cursor] === '>') return { insertAt, xlinkDeclarations };
    if (svg[cursor] === '/' && svg[cursor + 1] === '>') return { insertAt, xlinkDeclarations };

    const nameStart = cursor;
    while (cursor < svg.length && !/[\t\n\r =/>]/u.test(svg[cursor])) cursor += 1;
    if (cursor === nameStart) throw new Error(INVALID_SVG_ERROR);
    const name = svg.slice(nameStart, cursor);

    while (XML_WHITESPACE.test(svg[cursor] ?? '')) cursor += 1;
    if (svg[cursor] !== '=') throw new Error(INVALID_SVG_ERROR);
    cursor += 1;
    while (XML_WHITESPACE.test(svg[cursor] ?? '')) cursor += 1;

    const quote = svg[cursor];
    if (quote !== '"' && quote !== "'") throw new Error(INVALID_SVG_ERROR);
    cursor += 1;
    const valueStart = cursor;
    while (cursor < svg.length && svg[cursor] !== quote) cursor += 1;
    if (cursor >= svg.length) throw new Error(INVALID_SVG_ERROR);
    if (name === 'xmlns:xlink') xlinkDeclarations.push(svg.slice(valueStart, cursor));
    cursor += 1;
  }

  throw new Error(INVALID_SVG_ERROR);
};

const inspectParsedXlinkAttributes = (document: XMLDocument, root: Element) => {
  let hasExactXlinkHref = false;
  for (const element of [root, ...document.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'xmlns:xlink' && attribute.value !== XLINK_NAMESPACE) {
        throw new Error(INVALID_SVG_ERROR);
      }
      if (attribute.prefix === 'xlink') {
        if (attribute.namespaceURI !== XLINK_NAMESPACE) throw new Error(INVALID_SVG_ERROR);
        if (attribute.localName === 'href') hasExactXlinkHref = true;
      }
    }
  }
  return hasExactXlinkHref;
};

const tryParseSvg = (svg: string) => {
  try {
    return parseSvg(svg);
  } catch {
    return null;
  }
};

const normalizeMermaidXlinkNamespace = (svg: string) => {
  const { insertAt, xlinkDeclarations } = inspectLexicalSvgRoot(svg);
  if (xlinkDeclarations.length > 1 || (
    xlinkDeclarations.length === 1 && xlinkDeclarations[0] !== XLINK_NAMESPACE
  )) {
    throw new Error(INVALID_SVG_ERROR);
  }

  const parsed = tryParseSvg(svg);
  if (parsed) {
    inspectParsedXlinkAttributes(parsed.document, parsed.root);
    return svg;
  }
  if (xlinkDeclarations.length !== 0) throw new Error(INVALID_SVG_ERROR);

  const repaired = `${svg.slice(0, insertAt)} xmlns:xlink="${XLINK_NAMESPACE}"${svg.slice(insertAt)}`;
  const repairedParsed = parseSvg(repaired);
  if (!inspectParsedXlinkAttributes(repairedParsed.document, repairedParsed.root)) {
    throw new Error(INVALID_SVG_ERROR);
  }
  return repaired;
};

const isLocalFragment = (value: string) => /^#[^\s#]+$/u.test(value);

const unwrapCssUrl = (rawValue: string) => {
  const value = rawValue.trim();
  if (!value) return null;
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (value[value.length - 1] !== quote) return null;
    return value.slice(1, -1).trim();
  }
  if (value.includes('"') || value.includes("'")) return null;
  return value;
};

const hasSafeCssResources = (css: string) => {
  if (hasAmbiguousCssSyntax(css)) return false;

  let unsafeUrl = false;
  const withoutUrls = css.replace(CSS_URL, (_match, rawValue: string) => {
    const target = unwrapCssUrl(rawValue);
    if (!target || !isLocalFragment(target)) unsafeUrl = true;
    return '';
  });

  return !unsafeUrl
    && !CSS_URL_START.test(withoutUrls)
    && !CSS_EXTERNAL_TOKEN.test(withoutUrls);
};

interface CssRule {
  header: string;
  body: string;
}

const parseCssRules = (css: string): CssRule[] | null => {
  const rules: CssRule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (/\s/u.test(css[cursor] ?? '')) cursor += 1;
    if (cursor >= css.length) break;

    let open = -1;
    let quote = '';
    for (let index = cursor; index < css.length; index += 1) {
      const character = css[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '{') {
        open = index;
        break;
      }
    }
    if (open === -1 || quote) return null;

    let close = -1;
    let depth = 1;
    quote = '';
    for (let index = open + 1; index < css.length; index += 1) {
      const character = css[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close === -1 || quote) return null;

    const header = css.slice(cursor, open).trim();
    if (!header) return null;
    rules.push({ header, body: css.slice(open + 1, close) });
    cursor = close + 1;
  }

  return rules;
};

const isSafeKeyframes = ({ header, body }: CssRule) => {
  if (!/^@(?:-webkit-)?keyframes\s+[A-Za-z_][A-Za-z0-9_-]*$/u.test(header)) return false;
  const frames = parseCssRules(body);
  return Boolean(frames?.length) && frames!.every((frame) => (
    /^(?:(?:from|to)|(?:\d+(?:\.\d+)?%))(?:\s*,\s*(?:(?:from|to)|(?:\d+(?:\.\d+)?%)))*$/u.test(frame.header)
    && !/[{}]/u.test(frame.body)
    && hasSafeCssResources(frame.body)
    && !/@/u.test(frame.body)
  ));
};

const selectorStaysWithinRoot = (selector: string, rootSelector: string) => {
  if (!selector.startsWith(rootSelector)) return false;
  const remainder = selector.slice(rootSelector.length);
  if (/^[A-Za-z0-9_-]/u.test(remainder)) return false;

  let parentheses = 0;
  let brackets = 0;
  let quote = '';
  for (let index = 0; index < remainder.length; index += 1) {
    const character = remainder[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets -= 1;
    else if (parentheses === 0 && brackets === 0) {
      if (character === '+' || character === '~' || character === '|') return false;
      if (character === '>') return true;
      if (/\s/u.test(character)) {
        let lookahead = index + 1;
        while (/\s/u.test(remainder[lookahead] ?? '')) lookahead += 1;
        const next = remainder[lookahead] ?? '';
        if (next === '+' || next === '~' || next === '|') return false;
        return true;
      }
    }
    if (parentheses < 0 || brackets < 0) return false;
  }

  return !quote && parentheses === 0 && brackets === 0;
};

const hasOnlyScopedRules = (css: string, rootId: string) => {
  if (!SAFE_SVG_ID.test(rootId) || !hasSafeCssResources(css)) return false;

  const rootSelector = `#${rootId}`;
  const rules = parseCssRules(css);
  return Boolean(rules?.length) && rules!.every((rule) => {
    if (rule.header.startsWith('@')) return isSafeKeyframes(rule);
    if (/[{}]/u.test(rule.body) || /@/u.test(rule.body) || !hasSafeCssResources(rule.body)) return false;
    const selectors = rule.header.split(',').map((selector) => selector.trim());
    return selectors.length > 0
      && selectors.every((selector) => selectorStaysWithinRoot(selector, rootSelector));
  });
};

export const sanitizeMermaidSvg = (svg: string) => {
  // Reject a repaired non-SVG or malformed wrapper instead of letting sanitizer
  // recovery silently broaden the accepted renderer contract. Mermaid click
  // output is one narrow exception: 11.17.2 emits xlink:href without declaring
  // the standard namespace, so add that declaration before stripping the href.
  const { root: sourceRoot } = parseSvg(normalizeMermaidXlinkNamespace(svg));
  const sanitizedRoot = DOMPurify.sanitize(sourceRoot, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
    IN_PLACE: true,
  });
  const serialized = new XMLSerializer().serializeToString(sanitizedRoot);
  const { document, root } = parseSvg(serialized);

  const rootId = root.getAttribute('id') ?? '';
  for (const style of document.querySelectorAll('style')) {
    if (!hasOnlyScopedRules(style.textContent ?? '', rootId)) style.remove();
  }

  for (const element of [root, ...document.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.localName.toLowerCase();
      if (attributeName === 'href') {
        if (!isLocalFragment(attribute.value)) element.removeAttributeNode(attribute);
        continue;
      }

      const mayContainCssResource = CSS_VALUE_ATTRIBUTES.has(attributeName)
        || CSS_URL_START.test(attribute.value)
        || hasAmbiguousCssSyntax(attribute.value);
      if (mayContainCssResource && (!hasSafeCssResources(attribute.value) || /@/u.test(attribute.value))) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  return new XMLSerializer().serializeToString(root);
};
