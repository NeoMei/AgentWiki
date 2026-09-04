import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SyncApiException } from './sync-error';

const CURSOR_TTL_MS = 24 * 60 * 60 * 1_000;

interface CursorPayload {
  kind: 'snapshot' | 'delta' | 'snapshot-v2' | 'delta-v2';
  spaceId: string;
  revision: string;
  fromRevision?: string;
  lastPageId: string;
  expiresAt: number;
}

export type SyncV3CursorPayload = ({
  protocolVersion: '3';
  kind: 'snapshot-v3';
  spaceId: string;
  revision: string;
  objectKind: 'folder' | 'page' | 'attachment';
  lastCanonicalKey: string;
} | {
  protocolVersion: '3';
  kind: 'delta-v3';
  spaceId: string;
  fromRevision: string;
  toRevision: string;
  objectKind: string;
  lastCanonicalKey: string;
}) & { expiresAt: number };

type SyncV3CursorInput = SyncV3CursorPayload extends infer Payload
  ? Payload extends unknown ? Omit<Payload, 'expiresAt'> : never
  : never;

@Injectable()
export class SyncCursorService {
  constructor(private readonly config: ConfigService) {}

  private get secret(): Buffer {
    const value = this.config.get<string>('AGENTWIKI_SERVER_PEPPER');
    if (!value) throw new Error('AGENTWIKI_SERVER_PEPPER environment variable is required');
    return Buffer.from(value, 'utf8');
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update('obsidian-sync-cursor\0').update(payload).digest('base64url');
  }

  private verify(payload: string, signature: string): boolean {
    const expected = this.sign(payload);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  encode(payload: Omit<CursorPayload, 'expiresAt'>): string {
    const full = { ...payload, expiresAt: Date.now() + CURSOR_TTL_MS };
    const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decode(cursor: string): CursorPayload {
    const separator = cursor.lastIndexOf('.');
    if (separator <= 0) throw new SyncApiException('CURSOR_INVALID', 'Malformed cursor');
    const body = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    if (!this.verify(body, signature)) {
      throw new SyncApiException('CURSOR_INVALID', 'Cursor signature is invalid');
    }
    let payload: CursorPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
    } catch {
      throw new SyncApiException('CURSOR_INVALID', 'Cursor payload is malformed');
    }
    if (payload.expiresAt <= Date.now()) {
      throw new SyncApiException('CURSOR_INVALID', 'Cursor has expired');
    }
    return payload;
  }

  encodeV3(payload: SyncV3CursorInput): string {
    const full = { ...payload, expiresAt: Date.now() + CURSOR_TTL_MS };
    const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decodeV3(cursor: string): SyncV3CursorPayload {
    const fail = (): never => {
      throw new SyncApiException('CURSOR_INVALID', 'Cursor is invalid', undefined, '3');
    };
    const separator = cursor.lastIndexOf('.');
    if (separator <= 0 || cursor.length > 4096) fail();
    const body = cursor.slice(0, separator);
    const signature = cursor.slice(separator + 1);
    if (!this.verify(body, signature)) fail();
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      fail();
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail();
    const value = payload as Record<string, unknown>;
    const common = value.protocolVersion === '3'
      && typeof value.spaceId === 'string'
      && typeof value.lastCanonicalKey === 'string'
      && typeof value.objectKind === 'string'
      && typeof value.expiresAt === 'number'
      && Number.isSafeInteger(value.expiresAt)
      && value.expiresAt > Date.now();
    const snapshot = value.kind === 'snapshot-v3'
      && typeof value.revision === 'string'
      && ['folder', 'page', 'attachment'].includes(String(value.objectKind))
      && Object.keys(value).sort().join(',') === [
        'expiresAt', 'kind', 'lastCanonicalKey', 'objectKind', 'protocolVersion', 'revision', 'spaceId',
      ].sort().join(',');
    const delta = value.kind === 'delta-v3'
      && typeof value.fromRevision === 'string'
      && typeof value.toRevision === 'string'
      && Object.keys(value).sort().join(',') === [
        'expiresAt', 'fromRevision', 'kind', 'lastCanonicalKey', 'objectKind', 'protocolVersion', 'spaceId', 'toRevision',
      ].sort().join(',');
    if (!common || (!snapshot && !delta)) fail();
    return value as SyncV3CursorPayload;
  }
}
