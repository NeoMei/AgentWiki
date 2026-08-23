import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../core/filters/business-error';

export const HISTORY_KINDS = ['events', 'todos', 'attempts', 'artifacts', 'reviews'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export type HistoryPosition = { sequence: number } | { at: string; id: string };
export type RunListStatus = 'active' | 'history';

type CursorPayload = {
  v: 1;
  kind: HistoryKind;
  runId: string;
  position: HistoryPosition;
};

type RunListCursorPayload = {
  v: 1;
  scope: 'run-list';
  spaceId: string;
  status: RunListStatus;
  position: { at: string; id: string };
};

@Injectable()
export class HistoryCursorService {
  constructor(private readonly config: ConfigService) {}

  encode(input: Omit<CursorPayload, 'v'>): string {
    const body = Buffer.from(JSON.stringify({ v: 1, ...input }), 'utf8').toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decode(cursor: string, kind: HistoryKind, runId: string): HistoryPosition {
    try {
      if (cursor.length > 2_048) throw new Error('oversized');
      const separator = cursor.lastIndexOf('.');
      if (separator <= 0) throw new Error('malformed');
      const body = cursor.slice(0, separator);
      const signature = cursor.slice(separator + 1);
      if (!this.verify(body, signature)) throw new Error('signature');
      const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<CursorPayload>;
      if (!hasExactKeys(value, ['kind', 'position', 'runId', 'v'])
        || value.v !== 1 || value.kind !== kind || value.runId !== runId
        || !validPosition(kind, value.position)) {
        throw new Error('payload');
      }
      return value.position;
    } catch {
      throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
    }
  }

  encodeRunList(input: Omit<RunListCursorPayload, 'v' | 'scope'>): string {
    const body = Buffer.from(JSON.stringify({ v: 1, scope: 'run-list', ...input }), 'utf8').toString('base64url');
    return `${body}.${this.sign(body, 'collaboration-run-list-cursor\0')}`;
  }

  decodeRunList(cursor: string, spaceId: string, status: RunListStatus): { at: string; id: string } {
    try {
      if (cursor.length > 2_048) throw new Error('oversized');
      const separator = cursor.lastIndexOf('.');
      if (separator <= 0) throw new Error('malformed');
      const body = cursor.slice(0, separator);
      const signature = cursor.slice(separator + 1);
      if (!this.verify(body, signature, 'collaboration-run-list-cursor\0')) throw new Error('signature');
      const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<RunListCursorPayload>;
      if (!hasExactKeys(value, ['position', 'scope', 'spaceId', 'status', 'v'])
        || value.v !== 1 || value.scope !== 'run-list' || value.spaceId !== spaceId || value.status !== status
        || !validTimestampPosition(value.position)) {
        throw new Error('payload');
      }
      return value.position;
    } catch {
      throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
    }
  }

  private get secret(): Buffer {
    const value = this.config.get<string>('AGENTWIKI_SERVER_PEPPER');
    if (!value) throw new Error('AGENTWIKI_SERVER_PEPPER environment variable is required');
    return Buffer.from(value, 'utf8');
  }

  private sign(body: string, domain = 'collaboration-history-cursor\0'): string {
    return createHmac('sha256', this.secret)
      .update(domain)
      .update(body)
      .digest('base64url');
  }

  private verify(body: string, signature: string, domain?: string): boolean {
    const expected = Buffer.from(this.sign(body, domain));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

function validPosition(kind: HistoryKind, value: unknown): value is HistoryPosition {
  if (!value || typeof value !== 'object') return false;
  if (kind === 'events') {
    const sequence = (value as { sequence?: unknown }).sequence;
    return hasExactKeys(value, ['sequence']) && Number.isSafeInteger(sequence) && Number(sequence) >= 0;
  }
  return validTimestampPosition(value);
}

function validTimestampPosition(value: unknown): value is { at: string; id: string } {
  if (!value || typeof value !== 'object') return false;
  const position = value as { at?: unknown; id?: unknown };
  return hasExactKeys(value, ['at', 'id'])
    && typeof position.at === 'string'
    && !Number.isNaN(Date.parse(position.at))
    && typeof position.id === 'string'
    && /^[A-Za-z0-9._:-]{1,128}$/u.test(position.id);
}

function hasExactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
