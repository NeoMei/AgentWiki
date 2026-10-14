import { BadRequestException } from '@nestjs/common';

export const REVIEW_STATUSES = ['pending_review', 'approved', 'published', 'rejected', 'reverted'] as const;
export interface ReviewListQuery {
  page: number;
  pageSize: number;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}

export function parseReviewListQuery(query: Record<string, unknown>): ReviewListQuery {
  const number = (key: string, fallback: number, max: number) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw new BadRequestException(`Invalid ${key}`);
    return Number(value);
  };
  for (const key of ['q', 'status', 'from', 'to', 'spaceId']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') throw new BadRequestException(`Invalid ${key}`);
  }
  const { q, status, from, to } = query as Record<string, string | undefined>;
  if (q && q.length > 200) throw new BadRequestException('Search is too long');
  if (status && !REVIEW_STATUSES.includes(status as any)) throw new BadRequestException('Invalid review status');
  for (const date of [from, to]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)))) throw new BadRequestException('Invalid review date');
  }
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new BadRequestException('Invalid review date range');
  return { page: number('page', 1, 1000000), pageSize: number('pageSize', 25, 100), q: q?.trim(), status, from, to };
}
