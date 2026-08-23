import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import {
  COLLABORATION_LIMITS,
  CollaborationArtifactInputSchema,
  type CollaborationArtifactInput,
} from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';

export type ArtifactValidationIssue = { code: string; path: string; message: string };
export type ArtifactOutputContract = {
  key: string;
  kind: CollaborationArtifactInput['kind'];
  jsonSchema?: Record<string, unknown>;
};
export type ExternalReference = Extract<CollaborationArtifactInput, { kind: 'external_reference' }>['externalReference'];
export type ArtifactValidationResult = {
  valid: boolean;
  normalizedArtifact?: CollaborationArtifactInput;
  issues: ArtifactValidationIssue[];
};

const JSON_SCHEMA_KEYWORDS = new Set([
  '$schema', '$id', 'type', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minProperties', 'maxProperties', 'enum', 'const', 'allOf', 'anyOf', 'oneOf', 'not',
  'if', 'then', 'else', 'dependentRequired', 'propertyNames', 'contains', 'minContains', 'maxContains',
  'title', 'description', 'default', 'examples', 'readOnly', 'writeOnly',
]);
const FORBIDDEN_SCHEMA_KEYS = new Set(['$ref', '$dynamicRef', '$dynamicAnchor', '$anchor']);
const CACHE_LIMIT = 100;

@Injectable()
export class ArtifactValidator {
  private readonly ajv = new Ajv2020({ strict: true, allErrors: true, loadSchema: undefined });
  private readonly validators = new Map<string, ValidateFunction>();

  validate(input: unknown, contract: ArtifactOutputContract, requiredEvidence: string[]): ArtifactValidationResult {
    const parsed = CollaborationArtifactInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        valid: false,
        issues: parsed.error.issues.map((issue) => ({
          code: 'ARTIFACT_SCHEMA_INVALID',
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    if (parsed.data.kind !== contract.kind) {
      return issueResult('ARTIFACT_KIND_MISMATCH', 'artifact.kind', `Expected ${contract.kind}`);
    }
    const evidenceKinds = new Set(parsed.data.evidence.map((item) => item.kind));
    const missing = requiredEvidence.filter((kind) => !evidenceKinds.has(kind));
    if (missing.length) {
      return issueResult('EVIDENCE_REQUIRED', 'artifact.evidence', `Missing evidence: ${missing.join(', ')}`);
    }

    let normalizedArtifact = parsed.data;
    if (parsed.data.kind === 'external_reference') {
      normalizedArtifact = {
        ...parsed.data,
        externalReference: normalizeExternalReference(parsed.data.externalReference),
      };
    }
    if (parsed.data.kind === 'json') {
      if (!contract.jsonSchema) return issueResult('JSON_SCHEMA_REQUIRED', 'outputContract.jsonSchema', 'JSON Schema is required');
      const schemaIssues = inspectJsonSchema(contract.jsonSchema);
      if (schemaIssues.length) return { valid: false, issues: schemaIssues };
      let validate: ValidateFunction;
      try {
        validate = this.compile(contract.jsonSchema);
      } catch (error) {
        return issueResult('JSON_SCHEMA_UNSAFE', 'outputContract.jsonSchema', safeErrorMessage(error));
      }
      if (!validate(parsed.data.json)) {
        return {
          valid: false,
          issues: (validate.errors ?? []).slice(0, 50).map((error) => ({
            code: 'JSON_SCHEMA_INVALID',
            path: error.instancePath || 'artifact.json',
            message: error.message ?? 'JSON Schema validation failed',
          })),
        };
      }
    }
    return { valid: true, normalizedArtifact, issues: [] };
  }

  private compile(schema: Record<string, unknown>): ValidateFunction {
    const key = canonicalHash(schema);
    const cached = this.validators.get(key);
    if (cached) {
      this.validators.delete(key);
      this.validators.set(key, cached);
      return cached;
    }
    const compiled = this.ajv.compile(structuredClone(schema));
    this.validators.set(key, compiled);
    if (this.validators.size > CACHE_LIMIT) this.validators.delete(this.validators.keys().next().value!);
    return compiled;
  }
}

export function normalizeExternalReference(reference: ExternalReference): ExternalReference {
  if (reference.kind === 'workspace_path') {
    if (
      !reference.contentHash
      || reference.value.includes('\0')
      || reference.value.includes('\\')
      || /^[A-Za-z]:/u.test(reference.value)
      || reference.value.startsWith('/')
    ) throw invalidReference();
    const segments = reference.value.split('/');
    if (segments.some((segment) => segment === '..')) throw invalidReference();
    const value = segments.filter((segment) => segment && segment !== '.').join('/');
    if (!value) throw invalidReference();
    return { ...reference, value };
  }
  if (reference.kind === 'git_commit') {
    if (!reference.version || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(reference.value)) throw invalidReference();
    return reference;
  }
  let url: URL;
  try {
    url = new URL(reference.value);
  } catch {
    throw invalidReference();
  }
  const hasSecretKey = [...url.searchParams.keys()].some((key) =>
    /^(?:token|key|signature|sig|x-amz-.+|x-goog-.+)$/iu.test(key));
  if (url.protocol !== 'https:' || url.username || url.password || hasSecretKey || !reference.contentHash) {
    throw invalidReference();
  }
  url.hash = '';
  return { ...reference, value: url.toString() };
}

function inspectJsonSchema(schema: Record<string, unknown>): ArtifactValidationIssue[] {
  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    return [{ code: 'JSON_SCHEMA_UNSAFE', path: 'outputContract.jsonSchema', message: 'Schema is not serializable' }];
  }
  if (Buffer.byteLength(serialized, 'utf8') > COLLABORATION_LIMITS.jsonBytes) {
    return [{ code: 'JSON_SCHEMA_UNSAFE', path: 'outputContract.jsonSchema', message: 'Schema exceeds the byte limit' }];
  }
  const issues: ArtifactValidationIssue[] = [];
  scanSchema(schema, 'outputContract.jsonSchema', 0, false, issues);
  return issues.slice(0, 50);
}

function scanSchema(
  value: unknown,
  path: string,
  depth: number,
  propertyMap: boolean,
  issues: ArtifactValidationIssue[],
): void {
  if (depth > COLLABORATION_LIMITS.jsonDepth) {
    issues.push({ code: 'JSON_SCHEMA_UNSAFE', path, message: 'Schema exceeds the depth limit' });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => scanSchema(child, `${path}.${index}`, depth + 1, false, issues));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!propertyMap && FORBIDDEN_SCHEMA_KEYS.has(key)) {
      issues.push({ code: 'JSON_SCHEMA_UNSAFE', path: `${path}.${key}`, message: `${key} is not allowed` });
      continue;
    }
    if (!propertyMap && !JSON_SCHEMA_KEYWORDS.has(key)) {
      issues.push({ code: 'JSON_SCHEMA_UNSAFE', path: `${path}.${key}`, message: `Unknown JSON Schema keyword: ${key}` });
      continue;
    }
    scanSchema(child, `${path}.${key}`, depth + 1, key === 'properties', issues);
  }
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObject(child)]));
  }
  return value;
}

function issueResult(code: string, path: string, message: string): ArtifactValidationResult {
  return { valid: false, issues: [{ code, path, message }] };
}

function invalidReference(): BusinessException {
  return new BusinessException('COLLABORATION_EXTERNAL_REFERENCE_INVALID');
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : 'JSON Schema compilation failed';
}
