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

const isLocalFragment = (value: string) => /^#[^\s#]+$/u.test(value);

export const sanitizeMermaidSvg = (svg: string) => {
  // Reject a repaired non-SVG or malformed wrapper instead of letting sanitizer
  // recovery silently broaden the accepted renderer contract.
  const { root: sourceRoot } = parseSvg(svg);
  const sanitizedRoot = DOMPurify.sanitize(sourceRoot, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
    IN_PLACE: true,
  });
  const serialized = new XMLSerializer().serializeToString(sanitizedRoot);
  const { document, root } = parseSvg(serialized);

  for (const element of [root, ...document.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.localName.toLowerCase() !== 'href') continue;
      if (!isLocalFragment(attribute.value)) element.removeAttributeNode(attribute);
    }
  }

  return new XMLSerializer().serializeToString(root);
};
