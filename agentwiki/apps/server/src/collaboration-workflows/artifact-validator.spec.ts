import { BusinessException } from '../core/filters/business-error';
import { ArtifactValidator, normalizeExternalReference } from './artifact-validator';

const hash = 'a'.repeat(64);

describe('ArtifactValidator', () => {
  const validator = new ArtifactValidator();

  it('accepts a matching bounded JSON artifact and rejects schema failures', () => {
    const contract = {
      key: 'result', kind: 'json',
      jsonSchema: {
        type: 'object', additionalProperties: false, required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
    } as const;
    expect(validator.validate({ kind: 'json', json: { ok: true }, evidence: [] }, contract, [])).toMatchObject({ valid: true });
    expect(validator.validate({ kind: 'json', json: { ok: 'yes' }, evidence: [] }, contract, [])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'JSON_SCHEMA_INVALID' })]),
    });
  });

  it('rejects remote references, unknown keywords, over-deep schemas, and missing evidence', () => {
    for (const jsonSchema of [
      { $ref: 'https://example.com/schema.json' },
      { type: 'object', madeUpKeyword: true },
      deeplyNestedSchema(20),
    ]) {
      expect(validator.validate(
        { kind: 'json', json: {}, evidence: [] },
        { key: 'result', kind: 'json', jsonSchema },
        [],
      )).toMatchObject({ valid: false });
    }
    expect(validator.validate(
      { kind: 'markdown', markdown: 'done', evidence: [] },
      { key: 'result', kind: 'markdown' },
      ['test-log'],
    )).toMatchObject({ valid: false, issues: [{ code: 'EVIDENCE_REQUIRED', path: 'artifact.evidence', message: expect.any(String) }] });
  });

  it('normalizes safe external references and rejects traversal or secret-bearing URLs', () => {
    expect(normalizeExternalReference({
      kind: 'workspace_path', displayName: 'Output', value: './reports/result.md', contentHash: hash,
    })).toMatchObject({ value: 'reports/result.md' });
    expectBusinessCode(() => normalizeExternalReference({
      kind: 'workspace_path', displayName: 'Output', value: '../secret', contentHash: hash,
    }), 'COLLABORATION_EXTERNAL_REFERENCE_INVALID');
    expectBusinessCode(() => normalizeExternalReference({
      kind: 'url', displayName: 'Output', value: 'https://example.com/file?token=secret', contentHash: hash,
    }), 'COLLABORATION_EXTERNAL_REFERENCE_INVALID');
    expectBusinessCode(() => normalizeExternalReference({
      kind: 'git_commit', displayName: 'Commit', value: 'b'.repeat(40),
    }), 'COLLABORATION_EXTERNAL_REFERENCE_INVALID');
  });

  it.each([
    'access_token', 'access-token', 'access.token', 'refresh_token', 'api_key', 'api-key', 'apikey',
    'client_secret', 'signing-secret', 'auth_token', 'auth-token', 'id_token', 'bearer-token', 'jwt_token',
    'auth', 'bearer', 'jwt', 'credential', 'db_password', 'password',
    'secret', 'token', 'key', 'signature', 'request_signature', 'sig', 'request-sig',
    'provider', 'oauth-provider', 'client-api-key', 'basic_auth', 'X-Amz-Credential',
  ])('rejects the credential-bearing URL query key %s', (key) => {
    expectBusinessCode(() => normalizeExternalReference({
      kind: 'url', displayName: 'Output',
      value: `https://example.com/file?${key}=sensitive`, contentHash: hash,
    }), 'COLLABORATION_EXTERNAL_REFERENCE_INVALID');
  });

  it.each(['page', 'version'])('keeps the explicitly safe URL query key %s', (key) => {
    expect(normalizeExternalReference({
      kind: 'url', displayName: 'Output',
      value: `https://example.com/file?${key}=2`, contentHash: hash,
    })).toMatchObject({ value: `https://example.com/file?${key}=2` });
  });
});

function deeplyNestedSchema(depth: number): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: 'string' };
  for (let index = 0; index < depth; index += 1) schema = { type: 'array', items: schema };
  return schema;
}

function expectBusinessCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessException);
    expect(error).toMatchObject({ businessCode: code });
  }
}
