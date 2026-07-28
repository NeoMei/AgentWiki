import { createHash } from 'crypto';
import { posix } from 'path';
import { z } from 'zod';

const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

export interface NormalizedOkfEvidence {
  sourcePath: string;
  sourceHash: string;
  quote: string;
}

export interface NormalizedOkfDocument {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  evidence: NormalizedOkfEvidence[];
}

export interface NormalizedOkfEnvelope {
  okfVersion: '0.1';
  sourceKey: string;
  name: string;
  kind: 'code' | 'documents' | 'mixed';
  producer: { name: string; version: string };
  documents: NormalizedOkfDocument[];
  contentHash: string;
}

export class OkfEnvelopeError extends Error {
  readonly code: 'SOURCE_INVALID' | 'SOURCE_TOO_LARGE';

  constructor(code: OkfEnvelopeError['code'], message: string) {
    super(message);
    this.name = 'OkfEnvelopeError';
    this.code = code;
  }
}

const safePath = (value: string) => {
  if (!value || value.length > 512 || value.includes('\\') || value.includes('\0') || value.startsWith('/')) return false;
  const normalized = posix.normalize(value);
  return normalized === value && !normalized.startsWith('../') && normalized !== '..';
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const redactSecrets = (content: string) => content
  .replace(/(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[^\s'"]+/gi, '$1=[REDACTED]')
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');

const titleFromMarkdown = (path: string, content: string) =>
  content.match(/^#\s+(.+)$/m)?.[1].trim().slice(0, 200)
  || posix.basename(path, posix.extname(path)).replace(/[-_]+/g, ' ').slice(0, 200);

const pathSchema = z.string().refine(safePath, 'must be a relative POSIX path');
const hashSchema = z.string().regex(HASH_PATTERN, 'must be a SHA-256 hex digest');
const evidenceSchema = z.object({
  sourcePath: pathSchema,
  sourceHash: hashSchema,
  quote: z.string().max(500),
}).strict();
const documentSchema = z.object({
  path: pathSchema,
  content: z.string(),
  contentHash: hashSchema,
  evidence: z.array(evidenceSchema).max(20),
}).strict().superRefine((document, context) => {
  if (Buffer.byteLength(document.content, 'utf8') > MAX_DOCUMENT_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'must not exceed 1 MiB' });
  }
});
const envelopeSchema = z.object({
  okfVersion: z.literal('0.1'),
  sourceKey: z.string().min(1).max(512),
  name: z.string().min(1).max(200),
  kind: z.enum(['code', 'documents', 'mixed']),
  producer: z.object({
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(200),
  }).strict(),
  documents: z.array(documentSchema).max(500),
}).strict().superRefine((envelope, context) => {
  const seenPaths = new Set<string>();
  envelope.documents.forEach((document, index) => {
    if (seenPaths.has(document.path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['documents', index, 'path'], message: 'duplicate document path' });
    }
    seenPaths.add(document.path);
  });
});

type ParsedOkfEnvelope = z.infer<typeof envelopeSchema>;

const parseJson = (buffer: Buffer): unknown => {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new OkfEnvelopeError('SOURCE_INVALID', 'Invalid OKF JSON envelope');
  }
};

const validateEnvelope = (value: unknown): ParsedOkfEnvelope => {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new OkfEnvelopeError('SOURCE_INVALID', `Invalid OKF envelope: ${parsed.error.issues[0].message}`);
  }
  return parsed.data;
};

export function parseOkfEnvelope(buffer: Buffer): NormalizedOkfEnvelope {
  if (buffer.byteLength > MAX_ENVELOPE_BYTES) {
    throw new OkfEnvelopeError('SOURCE_TOO_LARGE', 'OKF envelope exceeds the 10 MiB limit');
  }

  const envelope = validateEnvelope(parseJson(buffer));
  const documents = envelope.documents.map((document) => {
    if (hash(document.content) !== document.contentHash.toLowerCase()) {
      throw new OkfEnvelopeError('SOURCE_INVALID', `Invalid OKF envelope: contentHash mismatch for ${document.path}`);
    }

    const content = redactSecrets(document.content);
    return {
      path: document.path,
      title: titleFromMarkdown(document.path, content),
      content,
      contentHash: hash(content),
      evidence: document.evidence.map((evidence) => ({
        sourcePath: evidence.sourcePath,
        sourceHash: evidence.sourceHash.toLowerCase(),
        quote: redactSecrets(evidence.quote),
      })),
    };
  });
  const normalized = {
    okfVersion: envelope.okfVersion,
    sourceKey: envelope.sourceKey,
    name: envelope.name,
    kind: envelope.kind,
    producer: envelope.producer,
    documents,
  };

  return { ...normalized, contentHash: hash(JSON.stringify(normalized)) };
}
