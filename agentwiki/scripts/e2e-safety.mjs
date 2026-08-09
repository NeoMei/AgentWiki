const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function assertE2ETarget(value, environment = process.env, prefix = 'AGENTWIKI_E2E') {
  if (environment[prefix] !== '1') {
    throw new Error(`This destructive verifier requires ${prefix}=1`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AgentWiki E2E target must be an absolute HTTP(S) URL');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('AgentWiki E2E target must be an absolute HTTP(S) URL without credentials');
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    if (environment[`${prefix}_ALLOW_REMOTE`] !== '1') {
      throw new Error(`A remote target requires ${prefix}_ALLOW_REMOTE=1`);
    }
    if (url.protocol !== 'https:') {
      throw new Error('A remote AgentWiki E2E target must use HTTPS');
    }
    const confirmedHost = environment[`${prefix}_CONFIRM_HOST`]?.trim().toLowerCase();
    if (!confirmedHost || confirmedHost !== url.hostname.toLowerCase()) {
      throw new Error('The AgentWiki E2E target must match the confirmed host');
    }
  }

  return url.toString().replace(/\/+$/u, '');
}
export async function cleanupFixture(fixture, remove) {
  const failures = [];
  for (const [kind, id] of [
    ['agent', fixture.agentId],
    ['space', fixture.spaceId],
    ['user', fixture.userId],
  ]) {
    if (!id) continue;
    try {
      await remove(kind, id);
    } catch {
      failures.push(kind);
    }
  }
  if (failures.length) throw new Error(`Cleanup failed for ${failures.join(', ')}`);
}
