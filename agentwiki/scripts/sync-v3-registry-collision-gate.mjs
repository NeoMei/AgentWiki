import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function explicitRegistryUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('An explicit registry URL is required');
  }
  let registry;
  try {
    registry = new URL(value);
  } catch {
    throw new Error('The explicit registry URL is invalid');
  }
  if (!['http:', 'https:'].includes(registry.protocol) || registry.username || registry.password) {
    throw new Error('The explicit registry URL must be an HTTP(S) URL without embedded credentials');
  }
  if (!registry.pathname.endsWith('/')) registry.pathname += '/';
  return registry;
}

async function publishedVersions(registry, candidate, fetchImpl) {
  const metadataUrl = new URL(encodeURIComponent(candidate.name), registry);
  let response;
  try {
    response = await fetchImpl(metadataUrl, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Registry request failed for ${candidate.name}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Registry request for ${candidate.name} returned status ${response.status}`);
  }
  let metadata;
  try {
    metadata = await response.json();
  } catch (error) {
    throw new Error(`Registry did not return valid registry metadata for ${candidate.name}`, {
      cause: error,
    });
  }
  const versions = isPlainObject(metadata) && isPlainObject(metadata.versions)
    ? Object.keys(metadata.versions)
    : [];
  if (
    !isPlainObject(metadata)
    || (metadata.name !== undefined && metadata.name !== candidate.name)
    || versions.length === 0
    || !versions.some((version) => semver.valid(version) === version)
  ) {
    throw new Error(`Registry did not return valid registry metadata for ${candidate.name}`);
  }
  return versions;
}

export async function assertNpmReleaseCandidatesAvailable({
  registryUrl,
  candidates,
  fetchImpl = fetch,
}) {
  const registry = explicitRegistryUrl(registryUrl);
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('At least one npm release candidate is required');
  }
  for (const candidate of candidates) {
    if (
      !candidate
      || typeof candidate.name !== 'string'
      || typeof candidate.version !== 'string'
      || candidate.name.length === 0
      || candidate.version.length === 0
    ) throw new Error('Each npm release candidate requires a package name and version');
  }

  const fetched = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    versions: await publishedVersions(registry, candidate, fetchImpl),
  })));
  const collision = fetched.find(({ candidate, versions }) => versions.includes(candidate.version));
  if (collision) {
    throw new Error(`${collision.candidate.name}@${collision.candidate.version} already exists`);
  }
  return { registryUrl: registry.href, candidates };
}

export async function releaseCandidates() {
  const localSync = await readFile(
    new URL('../packages/local-sync/package.json', import.meta.url),
    'utf8',
  ).then(JSON.parse);
  return [
    { name: localSync.name, version: localSync.version },
  ];
}

async function main(argv) {
  const registryArguments = argv.filter((value) => value.startsWith('--registry='));
  if (registryArguments.length !== 1 || argv.length !== 1) {
    throw new Error('Usage: sync-v3-registry-collision-gate.mjs --registry=<explicit-url>');
  }
  const registryUrl = registryArguments[0].slice('--registry='.length);
  const result = await assertNpmReleaseCandidatesAvailable({
    registryUrl,
    candidates: await releaseCandidates(),
  });
  process.stdout.write(`${JSON.stringify({ status: 'available', ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
