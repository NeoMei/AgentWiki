import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { onboardingDir, sessionFilePath, type OnboardingCheckpoint } from '../onboarding/session.js';

export async function readOnboardingStatus(home: string, sessionId?: string): Promise<Record<string, unknown>> {
  const checkpoint = sessionId
    ? await readCheckpoint(home, sessionId)
    : await readLatestCheckpoint(home);
  if (!checkpoint) return { state: 'not_found', ...(sessionId ? { sessionId } : {}) };
  const result = checkpoint.bootstrapResult ?? {};
  return {
    sessionId: checkpoint.sessionId,
    state: checkpoint.state,
    space: result.space,
    agent: result.agent,
    revisionId: result.revisionId,
    status: result.status,
    submissionId: result.submissionId,
    changeSetId: result.changeSetId,
    connectionId: checkpoint.inputs?.connectionId,
    manifestHash: checkpoint.inputs?.manifestHash,
    configBackupPath: checkpoint.inputs?.configBackupPath,
    agentReload: checkpoint.inputs?.reloadRequired ?? false,
    updatedAt: checkpoint.updatedAt,
  };
}

export async function readPreviewArtifactSummaries(home: string, jobId: string): Promise<Record<string, unknown>[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(jobId)) {
    throw new Error('Invalid preview job ID');
  }
  const raw = await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${jobId}.json`), 'utf8');
  const preview = JSON.parse(raw) as {
    data?: {
      pages?: Array<{ pageId: string; title: string; path: string; contentHash: string }>;
      memories?: Array<{ memoryId: string; key: string; contentHash: string }>;
      relations?: Array<{ relationId: string; sourceId: string; targetId: string; relationType: string }>;
    };
  };
  return [
    ...(preview.data?.pages ?? []).slice(0, 100).map((page) => ({
      kind: 'page', id: page.pageId, title: page.title, path: page.path, contentHash: page.contentHash,
    })),
    ...(preview.data?.memories ?? []).slice(0, 100).map((memory) => ({
      kind: 'memory', id: memory.memoryId, key: memory.key, contentHash: memory.contentHash,
    })),
    ...(preview.data?.relations ?? []).slice(0, 100).map((relation) => ({
      kind: 'relation', id: relation.relationId, sourceId: relation.sourceId,
      targetId: relation.targetId, relationType: relation.relationType,
    })),
  ].slice(0, 100);
}

async function readCheckpoint(home: string, sessionId: string): Promise<OnboardingCheckpoint | null> {
  if (!/^[A-Za-z0-9_-]+$/u.test(sessionId)) throw new Error('Invalid onboarding session ID');
  try {
    return JSON.parse(await readFile(sessionFilePath(sessionId, home), 'utf8')) as OnboardingCheckpoint;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readLatestCheckpoint(home: string): Promise<OnboardingCheckpoint | null> {
  const names = await readdir(onboardingDir(home)).catch(() => []);
  const checkpoints = await Promise.all(
    names
      .filter((name) => name.endsWith('.json') && !name.endsWith('.secret.json'))
      .map((name) => readCheckpoint(home, name.slice(0, -'.json'.length))),
  );
  return checkpoints
    .filter((value): value is OnboardingCheckpoint => value !== null)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}
