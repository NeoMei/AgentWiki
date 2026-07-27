// Shared markdown link handling: wiki-style [[Page Name]] resolution and
// internal vs external link classification for SPA navigation.

export interface PageLinkTarget {
  id: string;
  title?: string;
  slug?: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

// Resolve a [[wiki-link]] target to an internal /pages/{id} href by matching
// page id, slug, or title. Returns null when no page matches (rendered as-is).
export const resolveWikiHref = (name: string, pages: PageLinkTarget[]): string | null => {
  const needle = normalize(name);
  if (!needle) return null;
  const byId = pages.find((page) => normalize(page.id) === needle);
  if (byId) return `/pages/${byId.id}`;
  const bySlug = pages.find((page) => page.slug && normalize(page.slug) === needle);
  if (bySlug) return `/pages/${bySlug.id}`;
  const byTitle = pages.find((page) => page.title && normalize(page.title) === needle);
  if (byTitle) return `/pages/${byTitle.id}`;
  return null;
};

export const isInternalPageHref = (href?: string | null): boolean =>
  !!href && /^\/pages\/[^/?#]+/.test(href);

export const isExternalHref = (href?: string | null): boolean =>
  !!href && /^(https?:)?\/\//.test(href);
