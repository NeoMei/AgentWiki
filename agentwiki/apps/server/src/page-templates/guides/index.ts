import { projectGuides } from './project-guides';
import { codingGuides } from './coding-guides';
import { bidVideoGuides } from './bid-video-guides';
import { paperNovelGuides } from './paper-novel-guides';

const guides = { ...projectGuides, ...codingGuides, ...bidVideoGuides, ...paperNovelGuides };

/** A new built-in document must ship instructions instead of silently becoming an empty page. */
export function compositePageGuide(nodeId: string): { zh: string; en: string } {
  const guide = guides[nodeId];
  if (!guide?.zh.trim() || !guide.en.trim()) throw new Error(`Missing built-in page guidance: ${nodeId}`);
  return guide;
}
