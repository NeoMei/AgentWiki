# OpenCode Model Fallback and Cost Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make server-side editing assistance automatically use free OpenCode models first, then at most one automatically discovered lowest-estimated-cost paid model, with shared circuit breaking and trustworthy usage/cost metadata.

**Architecture:** Keep `OpencodeCliRunner` responsible for one explicit model invocation and JSON-event parsing. Add a cached `OpencodeModelCatalog`, Redis-backed `ModelHealthStore`, and `OpencodeModelRouter` that implements the queue-facing `OpencodeRunner` interface. Persist only sanitized routing metadata in `AssistTask.result`, and render its compact summary in the existing editing-assist panel.

**Tech Stack:** Node.js 24/26, TypeScript, NestJS 10, Jest 30, ioredis, React 18, Vitest, Testing Library, OpenCode CLI 1.18.12, pnpm 11.9.0.

## Global Constraints

- `ASSIST_OPENCODE_ALLOW_PAID_FALLBACK` defaults to `true`; `false` must exclude every paid model.
- Free candidates precede paid candidates. A task may try at most 3 free models and 1 paid model within one 180-second total budget.
- A model is free only when every parsed input/output/cache price is a finite zero; unknown or malformed prices fail closed.
- Paid models are discovered from `opencode models --verbose` and sorted by estimated task cost; no paid allowlist is required.
- Redis shares failure windows, open circuits, and one half-open probe across Workers. Redis failure must not by itself cause a paid fallback.
- Only objective execution or output-validity failures trigger fallback; no LLM quality-scoring call is allowed.
- API keys and raw provider/authentication errors must never enter task results, client output, or structured logs.
- The OpenCode child process receives only the existing environment allowlist and model IDs as separate argv entries, never shell interpolation.
- All new visible client copy must be available in Chinese and English.
- No Prisma migration is required; routing metadata remains backward-compatible JSON in `AssistTask.result`.

---

## File Structure

- Create `apps/server/src/assist/opencode.types.ts`: shared routing, usage, candidate, attempt, and typed-error contracts.
- Create `apps/server/src/assist/opencode.config.ts`: strict environment parsing and safe defaults.
- Create `apps/server/src/assist/opencode.config.spec.ts`: configuration defaults, limits, lists, and rejection tests.
- Create `apps/server/src/assist/opencode.catalog.ts`: verbose model parsing, cache/stale behavior, classification, and estimated-cost ordering.
- Create `apps/server/src/assist/opencode.catalog.spec.ts`: catalog parser, classification, cache, and ordering tests.
- Modify `apps/server/src/assist/opencode.runner.ts`: one explicit model per call, structured process errors, validated output, usage/cost aggregation.
- Modify `apps/server/src/assist/opencode.runner.spec.ts`: argv, timeout, output limit, result parsing, and sanitization tests.
- Create `apps/server/src/assist/model-health.store.ts`: Redis circuit state and half-open probe implementation.
- Create `apps/server/src/assist/model-health.store.spec.ts`: circuit threshold, TTL, reset, probe, and Redis-degradation tests.
- Modify `apps/server/src/database/redis.service.ts`: add strict TTL string write for observable circuit-store failures.
- Modify `apps/server/src/database/redis.service.spec.ts`: strict TTL write propagation regression.
- Create `apps/server/src/assist/opencode.router.ts`: free-first orchestration, budgets, candidate fallback, and sanitized result aggregation.
- Create `apps/server/src/assist/opencode.router.spec.ts`: complete routing sequence and terminal-failure tests.
- Modify `apps/server/src/assist/assist.queue.ts`: import shared types and retain safe routing result on failed tasks.
- Modify `apps/server/src/assist/assist.queue.spec.ts`: failed-result persistence regression.
- Modify `apps/server/src/assist/assist.module.ts` and `apps/server/src/worker.module.ts`: bind Router, Catalog, Runner, and Redis health store.
- Create `apps/server/src/assist/assist.module.spec.ts`: production provider binding regression.
- Modify `.env.example` and `apps/server/.env.example`: document defaults and operational controls.
- Modify `apps/client/src/features/page/AgentAssistPanel.tsx`: display model, tier, attempts, token total, and actual cost.
- Create `apps/client/src/features/page/AgentAssistPanel.spec.tsx`: Chinese/English safe metadata rendering.
- Create `scripts/assist-routing-e2e.mjs`: disposable real-API/OpenCode smoke with strict local/remote opt-in and cleanup.
- Create `scripts/assist-routing-e2e.test.mjs`: URL safety, redaction, and result-contract tests.

---

### Task 1: Shared Contracts and Strict Routing Configuration

**Files:**
- Create: `apps/server/src/assist/opencode.types.ts`
- Create: `apps/server/src/assist/opencode.config.ts`
- Create: `apps/server/src/assist/opencode.config.spec.ts`
- Modify: `apps/server/src/assist/assist.queue.ts`

**Interfaces:**
- Produces: `AssistInput`, `ModelUsage`, `ModelCandidate`, `OpencodeAttemptResult`, `AssistAttemptSummary`, `AssistRunResult`, `OpencodeRunner`, `OpencodeExecutionError`, `OpencodeRoutingError`, `RoutingConfig`, and `readRoutingConfig(ConfigService)`.
- Consumes: Nest `ConfigService` only.

- [ ] **Step 1: Write failing configuration tests**

Create tests that exercise the exact public API:

```ts
const config = (values: Record<string, string | undefined>) => ({
  get: jest.fn((key: string) => values[key]),
}) as any;

expect(readRoutingConfig(config({}))).toMatchObject({
  allowPaidFallback: true,
  maxFreeAttempts: 3,
  maxPaidAttempts: 1,
  estimatedOutputTokens: 2000,
});
expect(readRoutingConfig(config({ ASSIST_OPENCODE_ALLOW_PAID_FALLBACK: 'false' })).allowPaidFallback).toBe(false);
expect(readRoutingConfig(config({ ASSIST_OPENCODE_PAID_MODEL_EXCLUDES: 'x/a, x/a, y/b' })).paidModelExcludes)
  .toEqual(['x/a', 'y/b']);
expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_ALLOW_PAID_FALLBACK: 'yes' }))).toThrow('true or false');
expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_MAX_PAID_ATTEMPTS: '2' }))).toThrow('integer from 1 to 1');
expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_FREE_MODELS: '../bad' }))).toThrow('model ID');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.config.spec.ts`

Expected: FAIL because `opencode.config` and its exports do not exist.

- [ ] **Step 3: Add the shared contracts**

Define these exact shapes in `opencode.types.ts`:

```ts
export type ModelTier = 'free' | 'paid';
export type FailureCode =
  | 'auth_failed' | 'binary_unavailable' | 'budget_exhausted'
  | 'configuration_error' | 'invalid_output' | 'model_unavailable'
  | 'no_models' | 'output_limit' | 'process_error' | 'rate_limited' | 'timeout';

export interface AssistInput { intent: string; pageSnapshot: unknown; leaseExpiresAtMs?: number }
export interface ModelUsage {
  input: number; output: number; reasoning: number;
  cacheRead: number; cacheWrite: number; total: number;
}
export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ModelCandidate { id: string; tier: ModelTier; price: ModelPrice; estimatedCost: number }
export interface OpencodeAttemptResult {
  summary: string; changes: string; raw?: string; usage: ModelUsage; cost: number;
}
export interface AssistAttemptSummary {
  model: string; tier: ModelTier; durationMs: number; status: 'succeeded' | 'failed';
  errorCode?: FailureCode; usage: ModelUsage; cost: number;
}
export interface AssistRunResult {
  summary: string; changes?: string; proposedChangeSetId?: string; raw?: string;
  model?: string; modelTier?: ModelTier; attemptCount: number;
  usage: ModelUsage; cost: number; attempts: AssistAttemptSummary[];
}
export interface OpencodeRunner { run(task: AssistInput): Promise<AssistRunResult> }

export class OpencodeExecutionError extends Error {
  constructor(
    message: string,
    readonly code: FailureCode,
    readonly scope: 'model' | 'global',
    readonly usage: ModelUsage,
    readonly cost = 0,
  ) { super(message); }
}
export class OpencodeRoutingError extends Error {
  constructor(message: string, readonly result: AssistRunResult) { super(message); }
}
export const EMPTY_USAGE: ModelUsage = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0,
};
```

Remove the duplicate `AssistRunResult` and `OpencodeRunner` declarations from `assist.queue.ts`, import them from this file, and export them from `opencode.types.ts` as the only source of truth.

- [ ] **Step 4: Implement strict config parsing**

Use these exact defaults and hard ceilings in `opencode.config.ts`:

```ts
export interface RoutingConfig {
  freeModels: string[]; paidModelExcludes: string[]; allowPaidFallback: boolean;
  maxFreeAttempts: number; maxPaidAttempts: number; totalTimeoutMs: number;
  attemptTimeoutMs: number; modelCacheMs: number; modelStaleMs: number;
  modelEnumTimeoutMs: number; estimatedOutputTokens: number;
  circuitFailures: number; circuitWindowMs: number; circuitOpenMs: number;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const integer = (raw: unknown, fallback: number, name: string, max: number) => {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
};
const boolean = (raw: unknown, fallback: boolean, name: string) => {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
};
const models = (raw: unknown, name: string) => [...new Set(String(raw || '').split(',').map((x) => x.trim()).filter(Boolean))]
  .map((id) => {
    const hasPathSegment = id.split('/').some((part) => part === '.' || part === '..' || part === '');
    if (!MODEL_ID.test(id) || hasPathSegment) throw new Error(`${name} contains invalid model ID ${id}`);
    return id;
  });

export const readRoutingConfig = (config: ConfigService): RoutingConfig => ({
  freeModels: models(config.get('ASSIST_OPENCODE_FREE_MODELS'), 'ASSIST_OPENCODE_FREE_MODELS'),
  paidModelExcludes: models(config.get('ASSIST_OPENCODE_PAID_MODEL_EXCLUDES'), 'ASSIST_OPENCODE_PAID_MODEL_EXCLUDES'),
  allowPaidFallback: boolean(config.get('ASSIST_OPENCODE_ALLOW_PAID_FALLBACK'), true, 'ASSIST_OPENCODE_ALLOW_PAID_FALLBACK'),
  maxFreeAttempts: integer(config.get('ASSIST_OPENCODE_MAX_FREE_ATTEMPTS'), 3, 'ASSIST_OPENCODE_MAX_FREE_ATTEMPTS', 3),
  maxPaidAttempts: integer(config.get('ASSIST_OPENCODE_MAX_PAID_ATTEMPTS'), 1, 'ASSIST_OPENCODE_MAX_PAID_ATTEMPTS', 1),
  totalTimeoutMs: integer(config.get('ASSIST_OPENCODE_TIMEOUT_MS'), 180_000, 'ASSIST_OPENCODE_TIMEOUT_MS', 600_000),
  attemptTimeoutMs: integer(config.get('ASSIST_OPENCODE_ATTEMPT_TIMEOUT_MS'), 60_000, 'ASSIST_OPENCODE_ATTEMPT_TIMEOUT_MS', 180_000),
  modelCacheMs: integer(config.get('ASSIST_OPENCODE_MODEL_CACHE_MS'), 600_000, 'ASSIST_OPENCODE_MODEL_CACHE_MS', 86_400_000),
  modelStaleMs: integer(config.get('ASSIST_OPENCODE_MODEL_STALE_MS'), 3_600_000, 'ASSIST_OPENCODE_MODEL_STALE_MS', 86_400_000),
  modelEnumTimeoutMs: integer(config.get('ASSIST_OPENCODE_MODEL_ENUM_TIMEOUT_MS'), 10_000, 'ASSIST_OPENCODE_MODEL_ENUM_TIMEOUT_MS', 60_000),
  estimatedOutputTokens: integer(config.get('ASSIST_OPENCODE_ESTIMATED_OUTPUT_TOKENS'), 2_000, 'ASSIST_OPENCODE_ESTIMATED_OUTPUT_TOKENS', 128_000),
  circuitFailures: integer(config.get('ASSIST_OPENCODE_CIRCUIT_FAILURES'), 3, 'ASSIST_OPENCODE_CIRCUIT_FAILURES', 10),
  circuitWindowMs: integer(config.get('ASSIST_OPENCODE_CIRCUIT_WINDOW_MS'), 300_000, 'ASSIST_OPENCODE_CIRCUIT_WINDOW_MS', 3_600_000),
  circuitOpenMs: integer(config.get('ASSIST_OPENCODE_CIRCUIT_OPEN_MS'), 120_000, 'ASSIST_OPENCODE_CIRCUIT_OPEN_MS', 3_600_000),
});
```

`readRoutingConfig` must default paid fallback to `true`, cap free attempts at 3 and paid attempts at 1, and use the exact values from the spec for all remaining fields.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.config.spec.ts src/assist/assist.queue.spec.ts`

Expected: both suites PASS with no TypeScript diagnostic.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/assist/opencode.types.ts apps/server/src/assist/opencode.config.ts apps/server/src/assist/opencode.config.spec.ts apps/server/src/assist/assist.queue.ts
git commit -m "feat(assist): define model routing contracts"
```

---

### Task 2: Single-Model OpenCode Execution and Usage Parsing

**Files:**
- Modify: `apps/server/src/assist/opencode.runner.ts`
- Modify: `apps/server/src/assist/opencode.runner.spec.ts`

**Interfaces:**
- Consumes: `AssistInput`, `ModelUsage`, `OpencodeAttemptResult`, and `OpencodeExecutionError` from Task 1.
- Produces: `buildPrompt(task): string`, `listModels(timeoutMs): Promise<string>`, and `runModel(prompt, model, timeoutMs): Promise<OpencodeAttemptResult>`.

- [ ] **Step 1: Write failing single-model and parser tests**

Add assertions for explicit argv and actual OpenCode 1.18 events:

```ts
const execution = runner.runModel('prompt', 'opencode/big-pickle', 10_000);
expect(spawn).toHaveBeenCalledWith('opencode', [
  'run', '--model', 'opencode/big-pickle', '--format', 'json', 'prompt',
], expect.objectContaining({ env: expect.any(Object) }));

const output = [
  JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: 'ok', changes: '# Result' }) } }),
  JSON.stringify({ type: 'step_finish', part: { tokens: {
    total: 120, input: 70, output: 20, reasoning: 10, cache: { read: 15, write: 5 },
  }, cost: 0.0025 } }),
].join('\n');
expect((runner as any).parse(output)).toMatchObject({
  changes: '# Result', cost: 0.0025,
  usage: { total: 120, input: 70, output: 20, reasoning: 10, cacheRead: 15, cacheWrite: 5 },
});
expect(() => (runner as any).parse(JSON.stringify({ type: 'text', part: { text: 'plain text' } })))
  .toThrow(expect.objectContaining({ code: 'invalid_output', scope: 'model' }));
```

Also assert `listModels(10_000)` uses `['models', '--verbose']`, missing binary produces `binary_unavailable/global`, timeout produces `timeout/model`, output overflow produces `output_limit/global`, and no child environment contains `DATABASE_URL`, `JWT_SECRET`, or `REDIS_URL`.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.runner.spec.ts`

Expected: FAIL because the existing Runner has no `runModel`/`listModels` API, no usage aggregation, and accepts invalid plain text.

- [ ] **Step 3: Refactor Runner to one explicit model call**

Keep the current proven process termination/listener cleanup, but expose these methods:

```ts
buildPrompt(task: AssistInput): string {
  const snapshot = task.pageSnapshot ? JSON.stringify(task.pageSnapshot, null, 2) : '(no page snapshot)';
  return [
    'You are an editing assistant for AgentWiki. Help rewrite a page based on the user intent.',
    '', '## Page snapshot', snapshot, '', '## User intent', task.intent, '', '## Instructions',
    '- Produce the improved page content as markdown.',
    '- Do NOT call any tools or write anywhere; just return the improved content and a one-line summary.',
    '- Respond as JSON: {"summary": "...", "changes": "<full markdown>"}',
  ].join('\n');
}
listModels(timeoutMs: number): Promise<string> {
  return this.exec(['models', '--verbose'], timeoutMs, 'catalog');
}
async runModel(prompt: string, model: string, timeoutMs: number): Promise<OpencodeAttemptResult> {
  const output = await this.exec(['run', '--model', model, '--format', 'json', prompt], timeoutMs, 'model');
  return this.parse(output);
}
```

Change `exec` to classify start failure, timeout, output overflow, and nonzero exit as `OpencodeExecutionError`. Preserve stdout long enough to extract any `step_finish` usage/cost on a failed invocation, but limit public messages to the stable failure code. Use stderr only inside the local classifier and never place raw stderr into the thrown message.

- [ ] **Step 4: Validate event output instead of falling back to raw text**

Parse every JSON line, concatenate only assistant `part.text` fragments, sum every `step_finish.part.tokens` field and `part.cost`, then parse the final JSON object containing `changes`. Return `OpencodeAttemptResult` only when `changes.trim()` is non-empty. Throw `invalid_output/model` for empty, damaged, or schema-invalid output. Never use the event stream itself as `changes`.

Classify stable provider text with these bounded patterns:

```ts
if (/\b429\b|rate.?limit|too many requests/iu.test(text)) return 'rate_limited';
if (/unauthori[sz]ed|forbidden|invalid api key|authentication/iu.test(text)) return 'auth_failed';
if (/model .*not found|unknown model|model .*unavailable/iu.test(text)) return 'model_unavailable';
return 'process_error';
```

Unknown nonzero process errors remain `global`; known model/auth/rate errors are `model` scoped.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.runner.spec.ts`

Expected: all Runner tests PASS, including the existing SIGTERM/SIGKILL and listener-cleanup regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/assist/opencode.runner.ts apps/server/src/assist/opencode.runner.spec.ts
git commit -m "feat(assist): run explicit opencode models"
```

---

### Task 3: Model Catalog, Cache, Classification, and Cost Ordering

**Files:**
- Create: `apps/server/src/assist/opencode.catalog.ts`
- Create: `apps/server/src/assist/opencode.catalog.spec.ts`

**Interfaces:**
- Consumes: `OpencodeCliRunner`, `RoutingConfig`, `ModelCandidate`, and `ModelPrice`.
- Produces: `parseVerboseModels(output)`, `OpencodeModelCatalog.getModels()`, and `buildCandidates(models, config, prompt)`.

- [ ] **Step 1: Write failing catalog tests**

Use a fixture with one free, two paid, one inactive, one image-only, and one malformed-price model. Assert:

```ts
expect(parseVerboseModels(verboseFixture).map((model) => [model.id, model.tier])).toEqual([
  ['opencode/free', 'free'], ['vendor/cheap', 'paid'], ['vendor/expensive', 'paid'],
]);
const candidates = buildCandidates(models, routingConfig, '中文 prompt');
expect(candidates.map((candidate) => candidate.id)).toEqual([
  'opencode/free', 'vendor/cheap', 'vendor/expensive',
]);
expect(buildCandidates(models, { ...routingConfig, allowPaidFallback: false }, 'prompt'))
  .toHaveLength(1);
expect(buildCandidates(models, { ...routingConfig, paidModelExcludes: ['vendor/cheap'] }, 'prompt')[1].id)
  .toBe('vendor/expensive');
```

Add fake-timer tests proving one concurrent refresh, fresh-cache reuse, stale-cache fallback after refresh failure, and rejection when refresh fails beyond `modelStaleMs`.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.catalog.spec.ts`

Expected: FAIL because the catalog module does not exist.

- [ ] **Step 3: Implement the verbose stream parser**

Scan the output as model-ID line followed by a balanced JSON object. The scanner must track `{}` depth, quoted strings, and escapes so nested `capabilities`, `cost.cache`, and `variants` objects do not split the record. Normalize only records satisfying:

```ts
metadata.status === 'active'
&& metadata.capabilities?.input?.text === true
&& metadata.capabilities?.output?.text === true
```

Create `ModelPrice` only when input, output, cache.read, and cache.write are finite non-negative numbers. Classify as `free` only when all four equal zero; otherwise `paid`. Skip missing/invalid prices with a warning containing only the model ID.

- [ ] **Step 4: Implement cached refresh and candidate ordering**

`OpencodeModelCatalog` stores `{ loadedAt, models }` and one `refreshing` promise. `getModels()` returns a fresh snapshot, coalesces concurrent refreshes, and uses a snapshot no older than `modelStaleMs` after refresh failure.

Build candidate estimates exactly as specified:

```ts
const inputTokens = Math.max(1, [...prompt].length);
const estimatedCost = model.price.input * inputTokens
  + model.price.output * config.estimatedOutputTokens;
```

Apply configured free ordering first, append remaining free IDs in lexical order, then append non-excluded paid models sorted by estimated cost, output price, input price, and ID. Never promote a catalog-paid model placed in `freeModels`.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.catalog.spec.ts src/assist/opencode.runner.spec.ts`

Expected: both suites PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/assist/opencode.catalog.ts apps/server/src/assist/opencode.catalog.spec.ts
git commit -m "feat(assist): discover and rank opencode models"
```

---

### Task 4: Redis Model Circuit Breaker

**Files:**
- Create: `apps/server/src/assist/model-health.store.ts`
- Create: `apps/server/src/assist/model-health.store.spec.ts`
- Modify: `apps/server/src/database/redis.service.ts`
- Modify: `apps/server/src/database/redis.service.spec.ts`

**Interfaces:**
- Consumes: `RedisService`, `RoutingConfig`, and `FailureCode`.
- Produces: `ModelHealthStore` with `get`, `recordFailure`, `recordSuccess`, and `tryAcquireProbe`; `RedisModelHealthStore` production implementation.

- [ ] **Step 1: Write failing health-store tests**

Test these exact behaviors with an in-memory fake Redis service:

```ts
await store.recordFailure('vendor/model', 'process_error');
await store.recordFailure('vendor/model', 'process_error');
expect(await store.get('vendor/model')).toMatchObject({ openUntil: null, failures: 2 });
await store.recordFailure('vendor/model', 'process_error');
expect((await store.get('vendor/model'))!.openUntil).toBeGreaterThan(Date.now());
await store.recordSuccess('vendor/model');
expect(await store.get('vendor/model')).toBeNull();
expect(await store.tryAcquireProbe('vendor/model')).toBe(true);
expect(await store.tryAcquireProbe('vendor/model')).toBe(false);
```

Assert `rate_limited`, `model_unavailable`, and `auth_failed` open immediately; Redis method rejection returns a fail-open health state plus a warning and never throws into routing. Add a RedisService test proving `setStrict('key', 'value', 2)` invokes `setex` and propagates its rejection instead of swallowing it.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/model-health.store.spec.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement hashed Redis keys and bounded TTLs**

Define:

```ts
export interface ModelHealth { failures: number; openUntil: number | null }
export interface ModelHealthStore {
  get(model: string): Promise<ModelHealth | null>;
  recordFailure(model: string, code: FailureCode): Promise<void>;
  recordSuccess(model: string): Promise<void>;
  tryAcquireProbe(model: string): Promise<boolean>;
}
```

First add this strict Redis primitive, leaving the existing best-effort `set` unchanged for its current callers:

```ts
async setStrict(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const client = this.getClient();
  if (ttlSeconds) await client.setex(key, ttlSeconds, value);
  else await client.set(key, value);
}
```

Hash model IDs with `createHash('sha256').update(model).digest('hex')`. Use separate `fail`, `open`, and `probe` keys under `assist:model-health:`. Use `incrementWithWindow` for the five-minute counter, `setStrict` with TTL for `openUntil`, `deleteStrict` on success, and `setOnce` for the two-minute half-open probe. Catch Redis failures in every public store method, log only the model ID and stable operation name, and return `null`/`true` so the caller can continue free-first without forced paid escalation.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/model-health.store.spec.ts src/database/redis.service.spec.ts`

Expected: all health-store tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/assist/model-health.store.ts apps/server/src/assist/model-health.store.spec.ts apps/server/src/database/redis.service.ts apps/server/src/database/redis.service.spec.ts
git commit -m "feat(assist): share model circuit state in redis"
```

---

### Task 5: Free-First Router and Failed-Task Metadata

**Files:**
- Create: `apps/server/src/assist/opencode.router.ts`
- Create: `apps/server/src/assist/opencode.router.spec.ts`
- Modify: `apps/server/src/assist/assist.queue.ts`
- Modify: `apps/server/src/assist/assist.queue.spec.ts`

**Interfaces:**
- Consumes: `OpencodeModelCatalog`, `OpencodeCliRunner`, `ModelHealthStore`, `RoutingConfig`, and shared types.
- Produces: `OpencodeModelRouter implements OpencodeRunner`.

- [ ] **Step 1: Write failing routing-order tests**

Use fake Catalog, Runner, HealthStore, and clock. Prove:

```ts
runner.runModel
  .mockRejectedValueOnce(new OpencodeExecutionError('rate limited', 'rate_limited', 'model', EMPTY_USAGE))
  .mockResolvedValueOnce(success('# Free result'));
expect((await router.run(task)).model).toBe('free/two');
expect(runner.runModel.mock.calls.map((call) => call[1])).toEqual(['free/one', 'free/two']);

runner.runModel
  .mockRejectedValueOnce(modelFailure('invalid_output'))
  .mockRejectedValueOnce(modelFailure('model_unavailable'))
  .mockResolvedValueOnce(success('# Paid result', 0.004));
expect((await router.run(task))).toMatchObject({ model: 'paid/cheap', modelTier: 'paid', attemptCount: 3, cost: 0.004 });
```

Also prove: paid disabled never calls paid; global error stops immediately; 3-free/1-paid ceilings; total budget shrinks per-attempt timeout; the Worker lease minus a 5-second safety margin further shrinks that deadline; open circuits are skipped; all-open permits only one free half-open probe; successful model resets health; failed result carries sanitized attempts and aggregated partial cost.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.router.spec.ts`

Expected: FAIL because the Router does not exist.

- [ ] **Step 3: Implement routing with one monotonic deadline**

Implement `OnModuleInit` to call `readRoutingConfig` so invalid config fails at startup. In `run`:

```ts
const prompt = this.runner.buildPrompt(task);
const leaseDeadline = task.leaseExpiresAtMs === undefined ? Number.POSITIVE_INFINITY : task.leaseExpiresAtMs - 5_000;
const deadline = Math.min(this.now() + this.config.totalTimeoutMs, leaseDeadline);
const candidates = buildCandidates(await this.catalog.getModels(), this.config, prompt);
```

Take no more than configured free and paid counts. Before every call, calculate `remaining = deadline - now`; throw `budget_exhausted/global` without spawning when remaining is non-positive. Use `Math.min(attemptTimeoutMs, remaining)` as the child timeout. Record duration with the injected clock, aggregate usage/cost from success or typed error, and return immediately on the first valid success.

Only continue after `OpencodeExecutionError.scope === 'model'`. Convert every other error to one sanitized `OpencodeRoutingError`. Do not include raw stderr or provider text in `AssistAttemptSummary`.

In `AssistQueue.tick`, calculate the same `leaseExpiresAt` value used in the claim and pass `leaseExpiresAtMs: leaseExpiresAt.getTime()` into `processOne`/`runner.run`. This guarantees Router work ends before the queue lease can be recovered by another Worker.

- [ ] **Step 4: Persist safe metadata when all candidates fail**

Update `AssistQueue.processOne`:

```ts
const routing = error instanceof OpencodeRoutingError ? error : undefined;
data: {
  status: 'failed',
  error: routing ? routing.message : 'Editing assistant failed',
  ...(routing ? { result: routing.result as any } : {}),
  completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
}
```

Add a regression asserting a failed routing result retains `attemptCount`, `attempts[].errorCode`, usage, and cost while neither result nor `error` contains a fake API key/provider stderr fixture.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `pnpm --filter @agentwiki/server exec jest --runInBand src/assist/opencode.router.spec.ts src/assist/assist.queue.spec.ts`

Expected: all Router and Queue tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/assist/opencode.router.ts apps/server/src/assist/opencode.router.spec.ts apps/server/src/assist/assist.queue.ts apps/server/src/assist/assist.queue.spec.ts
git commit -m "feat(assist): route free models before paid fallback"
```

---

### Task 6: Nest Wiring, Environment Contract, and Client Metadata

**Files:**
- Modify: `apps/server/src/assist/assist.module.ts`
- Modify: `apps/server/src/worker.module.ts`
- Create: `apps/server/src/assist/assist.module.spec.ts`
- Modify: `.env.example`
- Modify: `apps/server/.env.example`
- Modify: `apps/client/src/features/page/AgentAssistPanel.tsx`
- Create: `apps/client/src/features/page/AgentAssistPanel.spec.tsx`

**Interfaces:**
- Consumes: Router, Catalog, Runner, `RedisModelHealthStore`, and existing Assist API result JSON.
- Produces: queue injection binding and bilingual compact cost metadata.

- [ ] **Step 1: Write failing module and client tests**

Add a server module test or provider assertion proving `OPENCODE_RUNNER` resolves to `OpencodeModelRouter`, not `OpencodeCliRunner`.

Create a client test that mocks `/assist/tasks` with:

```ts
result: {
  changes: '# Improved', model: 'opencode/big-pickle', modelTier: 'free',
  attemptCount: 2, usage: { total: 8648 }, cost: 0,
}
```

Assert English renders `opencode/big-pickle · Free · 2 attempts · 8,648 tokens · $0.000000`, Chinese renders `免费 · 2 次尝试`, and a failed task renders only sanitized `errorCode` metadata—not a provided `raw` or fake key.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/assist/assist.module.spec.ts
pnpm --filter @agentwiki/client exec vitest run src/features/page/AgentAssistPanel.spec.tsx
```

Expected: server binding test and client metadata assertions FAIL.

- [ ] **Step 3: Wire production providers**

In both `AssistModule` and `WorkerModule`, provide `OpencodeCliRunner`, `OpencodeModelCatalog`, `RedisModelHealthStore`, and `OpencodeModelRouter`; bind:

```ts
{ provide: 'MODEL_HEALTH_STORE', useExisting: RedisModelHealthStore },
{ provide: 'OPENCODE_RUNNER', useExisting: OpencodeModelRouter },
```

Ensure `DatabaseModule` remains imported so `RedisService` is available. Do not instantiate a second Redis client.

- [ ] **Step 4: Document the exact environment defaults**

Add every config line from the approved spec to both env examples. Include this warning immediately above the paid switch:

```env
# Default true: after free models fail, one automatically discovered paid model may incur cost.
ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=true
```

Do not add real model keys, credentials, or production-only values.

- [ ] **Step 5: Render compact safe metadata**

Add typed local result interfaces instead of `any` for routing metadata. For done and failed tasks with `result.model`, render one muted line below status. Format cost with six decimals and `Intl.NumberFormat` for tokens. Translate `Free/Paid`, singular/plural attempt text, and token/cost labels according to `language`; do not render `raw` or provider messages.

Use one local formatter and render only its return value:

```tsx
const routingMeta = (result: AssistRoutingResult | undefined, zh: boolean) => {
  if (!result?.model) return null;
  const tier = result.modelTier === 'paid' ? (zh ? '付费' : 'Paid') : (zh ? '免费' : 'Free');
  const attempts = zh ? `${result.attemptCount} 次尝试` : `${result.attemptCount} ${result.attemptCount === 1 ? 'attempt' : 'attempts'}`;
  const tokens = `${new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US').format(result.usage?.total || 0)} ${zh ? 'tokens' : 'tokens'}`;
  return `${result.model} · ${tier} · ${attempts} · ${tokens} · $${Number(result.cost || 0).toFixed(6)}`;
};

{routingMeta(task.result, zh) ? (
  <p className="mt-1 text-[11px] text-gray-500">{routingMeta(task.result, zh)}</p>
) : null}
```

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run:

```bash
pnpm --filter @agentwiki/server exec jest --runInBand src/assist
pnpm --filter @agentwiki/client exec vitest run src/features/page/AgentAssistPanel.spec.tsx
```

Expected: all Assist server suites and the new client suite PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/assist apps/server/src/worker.module.ts .env.example apps/server/.env.example apps/client/src/features/page/AgentAssistPanel.tsx apps/client/src/features/page/AgentAssistPanel.spec.tsx
git commit -m "feat(assist): expose model usage and cost metadata"
```

---

### Task 7: Real OpenCode E2E, Full Gates, and Production Smoke

**Files:**
- Create: `scripts/assist-routing-e2e.mjs`
- Create: `scripts/assist-routing-e2e.test.mjs`
- Modify: `package.json`
- Modify: `.codex-memory/tasks/active/opencode-model-fallback/brief.md`
- Modify: `.codex-memory/current.md`
- Modify: `.codex-memory/tasks/index.md`

**Interfaces:**
- Consumes: public Assist API, real bundled OpenCode CLI, temporary User/Space/Page APIs.
- Produces: `pnpm test:e2e:assist` safety-gated verifier and final project status evidence.

- [ ] **Step 1: Write failing E2E safety tests**

Export and test with these concrete environments:

```js
const localEnv = { AGENTWIKI_ASSIST_E2E: '1' };
const remoteEnv = {
  AGENTWIKI_ASSIST_E2E: '1',
  AGENTWIKI_ASSIST_E2E_ALLOW_REMOTE: '1',
  AGENTWIKI_ASSIST_E2E_CONFIRM_HOST: 'agentwiki.quukk.com',
};
assert.throws(() => requireOptIn({}), /AGENTWIKI_ASSIST_E2E=1/u);
assert.equal(assertTargetUrl('http://127.0.0.1:3000/api', localEnv), 'http://127.0.0.1:3000/api');
assert.equal(assertTargetUrl('https://agentwiki.quukk.com/api', remoteEnv), 'https://agentwiki.quukk.com/api');
assert.throws(() => assertTargetUrl('https://other.example/api', remoteEnv), /confirmed remote host/u);
assert.doesNotMatch(redact('Bearer abc agk_secret OPENAI_API_KEY=secret'), /abc|agk_secret|=secret/u);
```

Also unit-test the accepted task contract: `status=done`, non-empty changes, model ID, tier, integer attempt count, finite token fields, and finite non-negative actual cost.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test scripts/assist-routing-e2e.test.mjs`

Expected: FAIL because the E2E module does not exist.

- [ ] **Step 3: Implement the disposable verifier**

Follow the existing `local-sync-e2e.mjs` safety/redaction style. The script must:

1. require explicit opt-in and validate target URL;
2. register a unique temporary human User;
3. create a temporary Space and Page;
4. POST `/assist/tasks` with a deterministic Markdown rewrite request;
5. poll `/assist/tasks/:id` until `done` or `failed`, capped at 210 seconds;
6. validate `model`, `modelTier`, `attemptCount`, `usage`, `cost`, and non-empty `changes`;
7. print only redacted summary fields;
8. delete the temporary Space and current temporary User in `finally`, even after assertion failure.

Use this concrete control flow, with `apiRequest`, `eventually`, `redact`, and `assertTargetUrl` implemented in the same module:

```js
export async function main(environment = process.env) {
  requireOptIn(environment);
  const apiUrl = assertTargetUrl(environment.AGENTWIKI_API_URL || 'http://127.0.0.1:3000/api', environment);
  const suffix = `${Date.now()}-${process.pid}`;
  let token;
  let userId;
  let spaceId;
  try {
    const auth = await apiRequest(apiUrl, '/auth/register', {
      method: 'POST', body: { email: `assist-e2e-${suffix}@test.local`, name: 'Assist E2E', password: `Assist-${suffix}!` },
    });
    token = auth.access_token;
    userId = auth.user.id;
    const space = await apiRequest(apiUrl, '/spaces', { method: 'POST', token, body: { name: `Assist E2E ${suffix}` } });
    spaceId = space.id;
    const page = await apiRequest(apiUrl, '/pages', { method: 'POST', token, body: { spaceId, title: 'Routing test', content: '# Draft\n\nMake this clearer.' } });
    const task = await apiRequest(apiUrl, '/assist/tasks', {
      method: 'POST', token, body: { spaceId, pageId: page.id, intent: 'Rewrite this as concise Markdown.', snapshot: page },
    });
    const completed = await eventually(
      () => apiRequest(apiUrl, `/assist/tasks/${task.id}`, { token }),
      (value) => value?.status === 'done' || value?.status === 'failed',
      'assist routing task', 210_000,
    );
    assertAssistResult(completed);
    output({ status: completed.status, model: completed.result.model, tier: completed.result.modelTier,
      attempts: completed.result.attemptCount, usage: completed.result.usage, cost: completed.result.cost });
  } finally {
    if (token && spaceId) await apiRequest(apiUrl, `/spaces/${spaceId}`, { method: 'DELETE', token }).catch(() => undefined);
    if (token && userId) await apiRequest(apiUrl, `/users/${userId}`, { method: 'DELETE', token }).catch(() => undefined);
  }
}
```

Add `"test:e2e:assist": "node scripts/assist-routing-e2e.mjs"` to root `package.json`.

- [ ] **Step 4: Run safety tests and a real local OpenCode task**

Run:

```bash
node --test scripts/assist-routing-e2e.test.mjs
AGENTWIKI_ASSIST_E2E=1 AGENTWIKI_API_URL=http://127.0.0.1:3000/api pnpm test:e2e:assist
```

Expected: safety tests PASS; the live task is `done`, uses a discovered `free` model when the real free service is healthy, reports `cost: 0`, and cleanup succeeds. If the external free model is unavailable, report the actual bounded fallback result rather than weakening assertions or fabricating success.

- [ ] **Step 5: Run all repository gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits 0; report exact suite/test counts from fresh output.

- [ ] **Step 6: Review the complete diff for security and spec coverage**

Run:

```bash
git diff --check
git diff --stat c2f35c9..HEAD
rg -n "API_KEY|Authorization|raw:|stderr|DATABASE_URL|JWT_SECRET|REDIS_URL" apps/server/src/assist apps/client/src/features/page/AgentAssistPanel.tsx scripts/assist-routing-e2e.mjs
```

Expected: every sensitive reference is an environment allowlist, redaction assertion, or explicit non-forwarding test; no secret value, raw provider error, prompt, or page content is logged.

- [ ] **Step 7: Back up and deploy only after confirming the release action is authorized**

Create a timestamped PostgreSQL custom-format backup on `113.249.120.24`, verify it is non-empty with `pg_restore --list`, then run the existing deployment script:

```bash
ssh root@113.249.120.24 'set -a; . /root/agentwiki/apps/server/.env; set +a; stamp=$(date +%Y%m%d%H%M%S); mkdir -p /root/agentwiki-backups; file="/root/agentwiki-backups/agentwiki-pre-model-routing-$stamp.dump"; pg_dump -Fc "$DATABASE_URL" -f "$file"; test -s "$file"; pg_restore --list "$file" >/dev/null'
bash deploy.sh 113.249.120.24 root
curl --fail --silent --show-error https://agentwiki.quukk.com/api/health
```

Expected: backup verification exits 0, all three user systemd services are active, and health returns database/redis/auditPersistence `ok`.

- [ ] **Step 8: Run the remote disposable smoke with triple opt-in**

Run:

```bash
AGENTWIKI_ASSIST_E2E=1 \
AGENTWIKI_ASSIST_E2E_ALLOW_REMOTE=1 \
AGENTWIKI_ASSIST_E2E_CONFIRM_HOST=agentwiki.quukk.com \
AGENTWIKI_API_URL=https://agentwiki.quukk.com/api \
pnpm test:e2e:assist
```

Expected: task reaches `done`, model/attempt/token/cost metadata validates, cleanup confirms no disposable Space/User remains, and Worker logs contain no page content or credential material.

- [ ] **Step 9: Update task memory and commit verification assets**

Update `brief.md` to `completed` only after Steps 4-8 have fresh evidence. Replace the relevant lines in `current.md` with exact local gate counts, real model/tier/cost result, production backup path/checksum, health result, and remote smoke result. Move the task directory from `tasks/active` to `tasks/archive`, remove it from the active list in `tasks/index.md`, and add it to “最近完成”.

```bash
git mv ../.codex-memory/tasks/active/opencode-model-fallback ../.codex-memory/tasks/archive/opencode-model-fallback
git add scripts/assist-routing-e2e.mjs scripts/assist-routing-e2e.test.mjs package.json ../.codex-memory/current.md ../.codex-memory/tasks/index.md ../.codex-memory/tasks/archive/opencode-model-fallback
git commit -m "test(assist): verify opencode cost routing end to end"
```

---

## Final Review Checklist

- [ ] Every requirement in the approved design maps to Tasks 1-7.
- [ ] Paid fallback defaults to true and is disabled only by the explicit false switch.
- [ ] Catalog and cache never classify missing/invalid price data as free.
- [ ] Free success short-circuits before every paid candidate.
- [ ] One task cannot exceed 3 free attempts, 1 paid attempt, or its total deadline.
- [ ] Redis degradation cannot be the sole reason a task selects paid.
- [ ] Failed paid attempts contribute their reported usage/cost to the stored safe result.
- [ ] No secret, page body, prompt, stderr, or raw provider response reaches task APIs or logs.
- [ ] Local real CLI, full repository gates, backup, deployment health, and remote disposable smoke have fresh evidence before completion is claimed.
