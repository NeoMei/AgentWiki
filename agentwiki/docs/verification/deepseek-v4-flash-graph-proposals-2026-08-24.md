# DeepSeek V4 Flash graph proposal verification

## Result

The production graph proposal layer was moved from the retired hard-coded
`deepseek-chat` model to the official `deepseek-v4-flash` model on 2026-08-24
(Asia/Shanghai). Code commit `5b0fe34` is present on GitHub `master` and in
production.

DeepSeek's official API documentation identifies `deepseek-v4-flash` as the
current model id for V4 Flash and documents the OpenAI-compatible API at
`https://api.deepseek.com`:

- <https://api-docs.deepseek.com/news/news260424/>
- <https://api-docs.deepseek.com/api/create-chat-completion>

## Defects fixed

- `LlmService.generateText()` now honors `LLM_DEFAULT_MODEL` instead of always
  falling back to a compile-time model.
- The compile-time text and coding default is `deepseek-v4-flash`.
- The provider catalog contains the official V4 Flash model id and current
  context/pricing metadata.
- An unavailable LLM call releases its exact per-Space run claim, so a failed
  attempt does not consume the 24-hour successful-run interval.
- The Space settings UI renders the backend LLM reason, including unavailable,
  rate-limited, pending-proposal, and no-valid-proposal states.
- The server environment example pairs the V4 Flash default with the official
  direct DeepSeek gateway.

No API key is stored in Git, documentation, test fixtures, build artifacts, or
release evidence.

## Local verification

TDD regressions were observed failing before implementation and passing after
the fix. Fresh full-repository gates then passed:

| Gate | Result |
| --- | --- |
| Runtime contracts | 90 passed, 47 explicit environment skips |
| Server Jest | 802 passed, 3 explicit environment skips |
| Client Vitest | 241 passed |
| Sync protocol Vitest | 25 passed |
| Local Sync Vitest | 743 passed |
| Typecheck, lint, production build, `git diff --check` | passed |

A changed-diff credential-pattern scan found no API-key-shaped value.

## Production safety and deployment

Before deployment, the existing production health and all three user services
were verified. The following rollback artifacts were created and validated with
`pg_restore -l`, tar listing, SHA-256, and mode `0600`:

- database: `/root/backups/agentwiki/pre-deepseek-v4-flash-20260824-010610.dump`
  - SHA-256: `1e2c6422bcda722bcce8ea27fa89a861d47baaa65ca024d916705b749e8da93d`
- application: `/root/backups/agentwiki/pre-deepseek-v4-flash-20260824-010610-app.tar.gz`
  - SHA-256: `1edb206acd1bbab911e9364834979636efd58058da17342f48e53a2d1b77c687`

The previous application tree is retained at
`/root/agentwiki-previous-20260824010908`. Its pre-change environment copy is
retained at
`/root/agentwiki-previous-20260824010908/.env.pre-deepseek-v4-flash-20260824-010738`.

Production now reports only the non-secret configuration facts:

- `LLM_GATEWAY=direct`
- `LLM_DEFAULT_MODEL=deepseek-v4-flash`
- `DEEPSEEK_API_KEY` present

The production `.env` remains mode `0600`. The submitted key was validated with
one minimal official API call that returned HTTP 200 and model
`deepseek-v4-flash` before deployment.

## Real graph acceptance

The failed legacy LLM claim for `NeoMei-Space` was cleared after the backup. The
deployed `GraphRefreshService` then ran against the two real pages and returned:

```json
{"changeSetId":"cmt62cy37002i1frf8cfy7qw9","proposed":2}
```

The resulting ChangeSet is `pending_review` and contains exactly two pending
`auto_llm` items:

- `吃饭睡觉打豆豆` → `夜色渐浓`: `related_to`, confidence `0.9`
- `夜色渐浓` → `吃饭睡觉打豆豆`: `extends`, confidence `0.75`

No `auto_llm` relation was published directly. A second refresh returned
`proposal_pending`, and the ChangeSet remained at exactly two items, proving the
duplicate guard.

The public HTTP/MCP smoke passed all 31 checks and left zero new smoke users,
Spaces, or Agents. API, Worker, and Frontend remained active with zero restarts;
public health reported database, Redis, and audit persistence `ok`; no post-
deployment FATAL, HTTP 500, missing-key, or LLM-proposal failure log was found.
