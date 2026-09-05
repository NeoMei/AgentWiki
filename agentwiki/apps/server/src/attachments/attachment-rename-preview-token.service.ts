import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../core/filters/business-error';

const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const MAX_TOKEN_LENGTH = 16_384;
const TOKEN_DOMAIN = 'attachment-rename-preview-v1\0';

export interface AttachmentRenamePreviewTokenInput {
  spaceId: string;
  attachmentId: string;
  sourceIdentityHash: string;
  targetPath: string;
  displayName: string;
  attachmentUpdatedAt: string;
  contentTreeRevision: string;
  head: { id: string; hash: string } | null;
  evidenceHash: string;
}

export interface AttachmentRenamePreviewTokenPayload extends AttachmentRenamePreviewTokenInput {
  v: 1;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

@Injectable()
export class AttachmentRenamePreviewTokenService {
  constructor(private readonly config: ConfigService) {}

  encode(input: AttachmentRenamePreviewTokenInput): string {
    const issuedAt = Date.now();
    const payload: AttachmentRenamePreviewTokenPayload = {
      v: 1,
      ...input,
      nonce: randomBytes(16).toString('base64url'),
      issuedAt,
      expiresAt: issuedAt + PREVIEW_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const token = `${body}.${this.sign(body)}`;
    if (token.length > MAX_TOKEN_LENGTH) this.fail();
    return token;
  }

  decode(token: string, spaceId: string, attachmentId: string): AttachmentRenamePreviewTokenPayload {
    try {
      if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) this.fail();
      const separator = token.lastIndexOf('.');
      if (separator <= 0 || separator === token.length - 1) this.fail();
      const body = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      if (!this.verify(body, signature)) this.fail();
      const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
      if (!this.isPayload(value)) this.fail();
      if (value.spaceId !== spaceId || value.attachmentId !== attachmentId) this.fail();
      if (value.expiresAt <= Date.now() || value.issuedAt > Date.now() + 5_000) this.fail();
      return value;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.fail();
    }
  }

  private get secret(): Buffer {
    const value = this.config.get<string>('AGENTWIKI_SERVER_PEPPER');
    if (!value) throw new Error('AGENTWIKI_SERVER_PEPPER environment variable is required');
    return Buffer.from(value, 'utf8');
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(TOKEN_DOMAIN).update(body).digest('base64url');
  }

  private verify(body: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private isPayload(value: unknown): value is AttachmentRenamePreviewTokenPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    const exactKeys = [
      'attachmentId', 'attachmentUpdatedAt', 'contentTreeRevision', 'displayName',
      'evidenceHash', 'expiresAt', 'head', 'issuedAt', 'nonce', 'sourceIdentityHash',
      'spaceId', 'targetPath', 'v',
    ].sort();
    if (Object.keys(candidate).sort().join(',') !== exactKeys.join(',')) return false;
    const head = candidate.head;
    const validHead = head === null || (
      typeof head === 'object'
      && !Array.isArray(head)
      && Object.keys(head as object).sort().join(',') === 'hash,id'
      && typeof (head as { id?: unknown }).id === 'string'
      && typeof (head as { hash?: unknown }).hash === 'string'
      && /^[0-9a-f]{64}$/u.test((head as { hash: string }).hash)
    );
    return candidate.v === 1
      && typeof candidate.spaceId === 'string'
      && typeof candidate.attachmentId === 'string'
      && typeof candidate.sourceIdentityHash === 'string'
      && /^[0-9a-f]{64}$/u.test(candidate.sourceIdentityHash)
      && typeof candidate.targetPath === 'string'
      && typeof candidate.displayName === 'string'
      && typeof candidate.attachmentUpdatedAt === 'string'
      && /^\d{4}-\d{2}-\d{2}T/u.test(candidate.attachmentUpdatedAt)
      && typeof candidate.contentTreeRevision === 'string'
      && /^(?:0|[1-9][0-9]*)$/u.test(candidate.contentTreeRevision)
      && validHead
      && typeof candidate.evidenceHash === 'string'
      && /^[0-9a-f]{64}$/u.test(candidate.evidenceHash)
      && typeof candidate.nonce === 'string'
      && /^[A-Za-z0-9_-]{22}$/u.test(candidate.nonce)
      && typeof candidate.issuedAt === 'number'
      && Number.isSafeInteger(candidate.issuedAt)
      && typeof candidate.expiresAt === 'number'
      && Number.isSafeInteger(candidate.expiresAt)
      && candidate.expiresAt - candidate.issuedAt === PREVIEW_TTL_MS;
  }

  private fail(): never {
    throw new BusinessException('RESOURCE_CONFLICT', 'Rename preview is invalid or expired; preview again');
  }
}
