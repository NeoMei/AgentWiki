// Shared markdown link handling: wiki-style [[Page Name]] resolution and
// internal vs external link classification for SPA navigation.
import { slug } from 'github-slugger';
import type { WikiReference } from './markdown/obsidian';

export interface PageLinkTarget {
  id: string;
  title?: string;
  slug?: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

// Resolve a [[wiki-link]] target to an internal /pages/{id} href by matching
// page id, slug, or title. Returns null when no page matches (rendered as-is).
export const resolveWikiHref = (reference: WikiReference | string, pages: PageLinkTarget[]): string | null => {
  const parsed = typeof reference === 'string'
    ? { target: reference, heading: null, blockId: null }
    : reference;
  const needle = normalize(parsed.target);
  if (!needle) return null;
  const byId = pages.find((page) => normalize(page.id) === needle);
  const bySlug = pages.find((page) => page.slug && normalize(page.slug) === needle);
  const byTitle = pages.find((page) => page.title && normalize(page.title) === needle);
  const page = byId ?? bySlug ?? byTitle;
  if (!page) return null;

  const base = `/pages/${page.id}`;
  if (parsed.blockId) return `${base}#^${encodeURIComponent(parsed.blockId)}`;
  if (parsed.heading) return `${base}#${slug(parsed.heading)}`;
  return base;
};

export const isInternalPageHref = (href?: string | null): boolean =>
  !!href && /^\/pages\/[^/?#]+/.test(href);

export const isExternalHref = (href?: string | null): boolean =>
  !!href && /^(https?:)?\/\//.test(href);
