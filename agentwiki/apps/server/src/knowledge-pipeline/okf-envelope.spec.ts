import { createHash } from 'crypto';
import { parseOkfEnvelope } from './okf-envelope';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const valid = () => ({
  okfVersion: '0.1',
  sourceKey: 'repo-7f4e',
  name: 'Project Docs',
  kind: 'code',
  producer: { name: 'agentwiki-local-sync', version: '0.2.0' },
  documents: [{
    path: 'architecture/overview.md',
    content: '# Architecture\nSafe content',
    contentHash: hash('# Architecture\nSafe content'),
    evidence: [{ sourcePath: 'src/app.ts', sourceHash: hash('source'), quote: 'export class App' }],
  }],
});

const parse = (input: unknown) => parseOkfEnvelope(Buffer.from(JSON.stringify(input)));

describe('parseOkfEnvelope', () => {
  it('normalizes a valid envelope, derives the H1 title, and hashes normalized fields', () => {
    const parsed = parse(valid());

    expect(parsed.documents[0]).toMatchObject({ path: 'architecture/overview.md', title: 'Architecture' });
    expect(parsed.contentHash).toBe(hash(JSON.stringify({
      okfVersion: parsed.okfVersion,
      sourceKey: parsed.sourceKey,
      name: parsed.name,
      kind: parsed.kind,
      producer: parsed.producer,
      documents: parsed.documents,
    })));
  });

  it.each([
    ['/absolute.md'],
    ['../escape.md'],
    ['folder\\windows.md'],
    ['folder\0nul.md'],
  ])('rejects unsafe document path %s', (path) => {
    const input = valid();
    input.documents[0].path = path;
    expect(() => parse(input)).toThrow('relative POSIX path');
  });

  it.each([
    ['/absolute.ts'],
    ['../escape.ts'],
    ['src\\windows.ts'],
    ['src/\0nul.ts'],
  ])('rejects unsafe evidence sourcePath %s', (sourcePath) => {
    const input = valid();
    input.documents[0].evidence[0].sourcePath = sourcePath;
    expect(() => parse(input)).toThrow('relative POSIX path');
  });

  it('rejects duplicate paths', () => {
    const input = valid();
    input.documents.push({ ...input.documents[0] });
    expect(() => parse(input)).toThrow('duplicate');
  });

  it('rejects client content hash mismatches before redaction', () => {
    const input = valid();
    input.documents[0].contentHash = '0'.repeat(64);
    expect(() => parse(input)).toThrow('contentHash');
  });

  it('redacts secrets in documents and evidence before returning server-owned hashes', () => {
    const input = valid();
    input.documents[0].content = 'token=secret-value';
    input.documents[0].contentHash = hash(input.documents[0].content);
    input.documents[0].evidence[0].quote = 'password: hunter2';
    const parsed = parse(input);

    expect(parsed.documents[0].content).toBe('token=[REDACTED]');
    expect(parsed.documents[0].contentHash).toBe(hash('token=[REDACTED]'));
    expect(parsed.documents[0].evidence[0].quote).toBe('password: [REDACTED]');
  });

  it('rejects unknown top-level and document fields', () => {
    expect(() => parse({ ...valid(), ignored: true })).toThrow();
    const input = valid();
    Object.assign(input.documents[0], { absolutePath: '/tmp/secret' });
    expect(() => parse(input)).toThrow();
  });

  it.each([
    ['501 documents', (input: ReturnType<typeof valid>) => {
      input.documents = Array.from({ length: 501 }, (_, index) => ({
        ...input.documents[0], path: `document-${index}.md`,
      }));
    }],
    ['a document over 1 MiB', (input: ReturnType<typeof valid>) => {
      input.documents[0].content = 'x'.repeat(1024 * 1024 + 1);
      input.documents[0].contentHash = hash(input.documents[0].content);
    }],
    ['21 evidence entries', (input: ReturnType<typeof valid>) => {
      input.documents[0].evidence = Array.from({ length: 21 }, () => ({ ...input.documents[0].evidence[0] }));
    }],
    ['a quote over 500 characters', (input: ReturnType<typeof valid>) => {
      input.documents[0].evidence[0].quote = 'q'.repeat(501);
    }],
    ['a path over 512 characters', (input: ReturnType<typeof valid>) => {
      input.documents[0].path = `${'a'.repeat(510)}.md`;
    }],
  ])('rejects %s', (_label, mutate) => {
    const input = valid();
    mutate(input);
    expect(() => parse(input)).toThrow();
  });

  it('rejects JSON input over 10 MiB', () => {
    expect(() => parseOkfEnvelope(Buffer.from(' '.repeat(10 * 1024 * 1024 + 1)))).toThrow('10 MiB');
  });

  it('rejects malformed JSON and an unsupported OKF version', () => {
    expect(() => parseOkfEnvelope(Buffer.from('{'))).toThrow('OKF');
    expect(() => parse({ ...valid(), okfVersion: '0.2' })).toThrow();
  });
});
