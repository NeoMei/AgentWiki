import { Injectable } from '@nestjs/common';

export interface WikiLinkTarget {
  sourcePageId: string;
  target: string;
}

export interface ResolvedPair {
  sourcePageId: string;
  targetPageId: string;
}

export interface SimilarPair {
  sourcePageId: string;
  targetPageId: string;
  score: number;
}

const WIKILINK_PATTERN = /\[\[([^\[\]|]+)(?:\|[^\[\]]+)?\]\]/g;

@Injectable()
export class GraphExtractionService {
  extractWikiLinks(content: string): string[] {
    const targets = new Set<string>();
    for (const match of content.matchAll(WIKILINK_PATTERN)) {
      const target = (match[1] || '').trim();
      if (target) targets.add(target);
    }
    return [...targets];
  }

  resolveWikiLinks(
    pages: Array<{ id: string; title: string; slug: string }>,
    links: WikiLinkTarget[],
  ): { resolved: ResolvedPair[]; dangling: number } {
    const byExact = new Map<string, string>();
    const byLower = new Map<string, string>();
    const bySlug = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const page of pages) {
      if (byExact.has(page.title)) ambiguous.add(page.title);
      byExact.set(page.title, page.id);
      const lower = page.title.toLowerCase();
      if (byLower.has(lower)) ambiguous.add(lower);
      byLower.set(lower, page.id);
      if (bySlug.has(page.slug)) ambiguous.add(page.slug);
      bySlug.set(page.slug, page.id);
    }
    const resolved: ResolvedPair[] = [];
    let dangling = 0;
    for (const link of links) {
      const targetId = this.resolveTarget(link.target, byExact, byLower, bySlug, ambiguous);
      if (!targetId || targetId === link.sourcePageId) {
        dangling += 1;
        continue;
      }
      resolved.push({ sourcePageId: link.sourcePageId, targetPageId: targetId });
    }
    return { resolved, dangling };
  }

  private resolveTarget(
    target: string,
    byExact: Map<string, string>,
    byLower: Map<string, string>,
    bySlug: Map<string, string>,
    ambiguous: Set<string>,
  ): string | null {
    const exact = byExact.get(target);
    if (exact && !ambiguous.has(target) && !ambiguous.has(target.toLowerCase())) return exact;
    const lower = target.toLowerCase();
    const lowered = byLower.get(lower);
    if (lowered && !ambiguous.has(lower)) return lowered;
    const slug = lower.replace(/\s+/g, '-');
    const slugged = bySlug.get(slug);
    if (slugged && !ambiguous.has(slug)) return slugged;
    return null;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      dot += a[index] * b[index];
      normA += a[index] * a[index];
      normB += b[index] * b[index];
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  computeSimilarPairs(
    pages: Array<{ id: string; embedding: number[] | null }>,
    threshold: number,
  ): SimilarPair[] {
    const withEmbeddings = pages.filter((page): page is { id: string; embedding: number[] } =>
      Array.isArray(page.embedding) && page.embedding.length > 0);
    const pairs: SimilarPair[] = [];
    for (let i = 0; i < withEmbeddings.length; i += 1) {
      for (let j = i + 1; j < withEmbeddings.length; j += 1) {
        const left = withEmbeddings[i];
        const right = withEmbeddings[j];
        const score = this.cosineSimilarity(left.embedding, right.embedding);
        if (score < threshold) continue;
        const [sourcePageId, targetPageId] = left.id < right.id
          ? [left.id, right.id]
          : [right.id, left.id];
        pairs.push({ sourcePageId, targetPageId, score });
      }
    }
    return pairs;
  }
}
