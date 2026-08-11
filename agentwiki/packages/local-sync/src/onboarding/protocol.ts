/**
 * NDJSON onboarding protocol: versioned events on stdout, structured replies
 * on stdin, monotonic sequence numbers and requestId correlation.
 *
 * Only one JSON object per line is ever written to stdout; diagnostics go to
 * stderr exclusively. The protocol is deterministic — no natural-language
 * parsing, no hidden prompts, no undeclared fields.
 */
import { z } from 'zod';
import type { OnboardingFailure } from './errors.js';

export const PROTOCOL_VERSION = 1;

const sessionIdSchema = z.string().min(1);
const requestIdSchema = z.string().min(1);
const isoTimestampSchema = z.string().datetime({ offset: true });

/* ------------------------------------------------------------------ */
/* Form field schema (input_required events)                           */
/* ------------------------------------------------------------------ */

export const FormFieldType = z.enum(['string', 'choice', 'paths']);
export type FormFieldType = z.infer<typeof FormFieldType>;

export const FormFieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: FormFieldType,
    required: z.boolean().default(true),
    choices: z.array(z.string()).optional(),
    defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
    help: z.string().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'choice' && (!field.choices || field.choices.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'choice field requires choices', path: ['choices'] });
    }
  });
export type FormField = z.infer<typeof FormFieldSchema>;

/* ------------------------------------------------------------------ */
/* Outbound event schemas (script → Agent, one object per stdout line) */
/* ------------------------------------------------------------------ */

const eventCommon = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: sessionIdSchema,
  timestamp: isoTimestampSchema,
};

export const InputRequiredEvent = z.object({
  ...eventCommon,
  type: z.literal('input_required'),
  seq: z.number().int().positive(),
  requestId: requestIdSchema,
  fields: z.array(FormFieldSchema),
});

export const AuthorizationRequiredEvent = z.object({
  ...eventCommon,
  type: z.literal('authorization_required'),
  seq: z.number().int().positive(),
  requestId: requestIdSchema,
  url: z.string().url(),
  userCode: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});

export const ProgressEvent = z.object({
  ...eventCommon,
  type: z.literal('progress'),
  seq: z.number().int().positive(),
  step: z.string().min(1),
  status: z.enum(['running', 'done', 'skipped']),
  detail: z.string().optional(),
});

export const HeartbeatEvent = z.object({
  ...eventCommon,
  type: z.literal('heartbeat'),
  seq: z.number().int().positive(),
  step: z.string().min(1),
});

export const PreviewEvent = z.object({
  ...eventCommon,
  type: z.literal('preview'),
  seq: z.number().int().positive(),
  plan: z.record(z.unknown()),
});

export const ConfirmationRequiredEvent = z.object({
  ...eventCommon,
  type: z.literal('confirmation_required'),
  seq: z.number().int().positive(),
  requestId: requestIdSchema,
  planHash: z.string().min(1),
  summary: z.record(z.unknown()).optional(),
});

export const CompletedEvent = z.object({
  ...eventCommon,
  type: z.literal('completed'),
  seq: z.number().int().positive(),
  report: z.record(z.unknown()),
});

export const FailedEvent = z.object({
  ...eventCommon,
  type: z.literal('failed'),
  seq: z.number().int().positive(),
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  resumeSessionId: z.string().optional(),
  nextAction: z.string().optional(),
});

export const OnboardingEventSchema = z.discriminatedUnion('type', [
  InputRequiredEvent,
  AuthorizationRequiredEvent,
  ProgressEvent,
  HeartbeatEvent,
  PreviewEvent,
  ConfirmationRequiredEvent,
  CompletedEvent,
  FailedEvent,
]);

export type OnboardingEvent = z.infer<typeof OnboardingEventSchema>;

/* ------------------------------------------------------------------ */
/* Inbound reply schemas (Agent → script, one object per stdin line)   */
/* ------------------------------------------------------------------ */

export const InputReplySchema = z
  .object({
    requestId: requestIdSchema,
    values: z.record(z.unknown()),
  })
  .strict();

export type InputReply = z.infer<typeof InputReplySchema>;

export const ConfirmationReplySchema = z
  .object({
    requestId: requestIdSchema,
    confirmed: z.boolean(),
    planHash: z.string().min(1),
  })
  .strict();

export type ConfirmationReply = z.infer<typeof ConfirmationReplySchema>;
export type ParsedReply = InputReply | ConfirmationReply;

export function isConfirmationReply(reply: ParsedReply): reply is ConfirmationReply {
  return 'confirmed' in reply;
}

/* ------------------------------------------------------------------ */
/* Encoder / decoder                                                   */
/* ------------------------------------------------------------------ */

/** Distributive Omit preserves the discriminated-union relationship. */
type DistributiveOmit<T, K extends string | number | symbol> = T extends unknown
  ? Omit<T, K>
  : never;

/** The shape a caller passes to emit(), without protocol-managed fields. */
export type EmittableEvent = DistributiveOmit<
  OnboardingEvent,
  'protocolVersion' | 'sessionId' | 'timestamp' | 'seq'
>;

export interface ProtocolSink {
  write(line: string): void;
}

export interface ProtocolSource {
  read(): Promise<string | null>;
}

/**
 * ProtocolEncoder owns the monotonic sequence counter and guarantees that each
 * event is emitted as exactly one JSON object terminated by a newline.
 */
export class ProtocolEncoder {
  private seq = 0;
  private readonly sink: ProtocolSink;
  private readonly sessionId: string;

  constructor(sessionId: string, sink: ProtocolSink) {
    this.sessionId = sessionId;
    this.sink = sink;
  }

  emit(event: EmittableEvent): OnboardingEvent {
    this.seq += 1;
    const full = {
      ...event,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      seq: this.seq,
    } as OnboardingEvent;
    this.sink.write(JSON.stringify(full) + '\n');
    return full;
  }

  /** Convenience helper for emitting a failure from an OnboardingFailure. */
  emitFailure(failure: OnboardingFailure): OnboardingEvent {
    return this.emit({
      type: 'failed',
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      ...(failure.resumeSessionId !== undefined ? { resumeSessionId: failure.resumeSessionId } : {}),
      ...(failure.nextAction !== undefined ? { nextAction: failure.nextAction } : {}),
    });
  }
}

/**
 * Parse one inbound line into a typed reply. Throws on malformed JSON,
 * unknown fields, or protocol-version mismatch so the caller can fail before
 * any side effect.
 */
export function parseReply(line: string): ParsedReply {
  const trimmed = line.trim();
  if (trimmed.length === 0) throw new ProtocolParseError('empty reply line');
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new ProtocolParseError('reply is not valid JSON');
  }
  if (json !== null && typeof json === 'object' && 'confirmed' in json) {
    return ConfirmationReplySchema.parse(json);
  }
  return InputReplySchema.parse(json);
}

export class ProtocolParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolParseError';
  }
}

/** Validate an outbound event against the full schema (used by tests). */
export function assertValidEvent(event: unknown): OnboardingEvent {
  return OnboardingEventSchema.parse(event);
}
