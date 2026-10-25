# Embedded Agent execution failure — 2026-10-26

## Original failure and evidence

The user requested `根据本目录 所有测试报告，更新 bug 状态汇总表` on the existing Bug status page. The two recorded production tasks exhausted the configured 300-second model budget. The latest task was `cmvnzrwde01a913pya6324rid`; its fixed target was `0459b4aa-47b3-4959-b092-20c9a9d8dbf8`. The authorized directory contains nine documents: seven dated reports, the status table itself, and an older overall report. Their full bodies total 137,879 UTF-16 characters; ten history turns serialize to another 115,789 characters.

The read-only baseline replay reproduced the failure. The first generation read only part of the directory and returned prose before its JSON, so the strict parser rejected it. The format retry restarted directory reads and exhausted the common deadline. MCP calls completed; the evidence does not support a permissions denial or an unavailable service as this failure's cause.

`live-real-baseline-receipt.json` records the baseline. `live-real-candidate-receipt.json` records a rejected intermediate approach: bulk tool output was truncated by OpenCode and it covered only six selected documents. That bulk tool was withdrawn and is not part of this release.

## Repair

- Write generation receives a complete authorized directory snapshot directly when the **whole** prompt, including history, page, references, instructions and possible retry suffix, fits 256,000 characters and 1,000,000 UTF-8 bytes. Otherwise it falls back as a whole to the existing read tools. Decision and answer prompts do not preload the directory.
- Identical repeated historical source bodies are encoded once in the prompt; stored history remains unchanged and lossless.
- Both directory tools keep serialized responses at or below 40 KiB, below OpenCode 2.1.1's 50 KiB truncation limit. Pagination preserves exact offsets, Unicode boundaries and every source character, including JSON escaping overhead. Oversized metadata fails explicitly instead of producing an incomplete or stalled page.
- Session failures expose an allowlisted reason (timeout, invalid format, unavailable service, rate limit or output limit), with fixed user-facing messages. Raw provider errors and credentials are not returned.

The strict JSON parser, action decision, fixed write destination, current authorization checks and optimistic version check are unchanged.

## Verification

The correct candidate replay used the same failed task and stored history, the same model and 300-second budget. It completed in **216,601 ms**, returning `action=update` without a format retry. The generation prompt was 244,029 characters / 436,880 bytes. The probe decoded its directory section and verified all **9/9 bodies by exact equality and SHA-256**. No directory tool calls or tool-output truncation occurred. See `live-real-inline-receipt.json`.

After deployment, the same read-only replay completed in **147,111 ms** with one successful Qwen attempt and no format retry. The final generation prompt was 244,601 characters / 437,452 bytes and again verified 9/9 exact bodies. See `live-deployed-real-inline-receipt.json`; the original page, database task state and Redis health state were not changed by either probe.

The replay is read-only: it does not change pages, task rows or shared router health. Its success proves source delivery and execution, not final document correctness or queue/save behavior. Generated content remains private on the server; independent content review and isolated queue/save acceptance are separate evidence.

Local verification on the final product patch: server 3,628 passed / 44 skipped; Agent panel 89 passed; offline acceptance-plan tests 5 passed; typecheck, changed-source ESLint, server/client builds and `git diff --check` passed. The server suite includes 115 runner/history tests and 25 real MCP stdio pagination tests. The skipped tests require dedicated environments. An independent product review found no P1/P2 blocker.

## Production and save acceptance

v0.12.60 (`99e66da0e72be583a9d1363760f17f2481a9d4ba`) is deployed. The paired backup `/var/backups/agentwiki/agent-failure-v01260.PcRiCrTx` was verified and services were restored before deployment. A 1,436-file manifest, three services, five health checks and the public entry assets all match the frozen release; see `production-host.json`, `production-public.json` and `deployment-receipt.json`.

An isolated folder with exact copies of the nine current source pages was created through the normal governed MCP path. A new browser session submitted the original request and reached `done` in 113.839 seconds with `action=update`, an `updated` document receipt for the isolated target, and a persisted 5,561-character result. Database readback matched the saved page to the receipt byte-for-byte; the nine original source pages and eight non-target copies retained their original bodies and versions. The isolated folder was then removed through the normal browser folder flow (recoverable soft delete). See `../agent-auto-edit-20261026/mcp-fixture-receipt.json` and the acceptance sequence.

The generated table was not applied to the user's original page. Independent review found the 66 original items retained, but the model still needs human review for source-link completeness and a few “code fixed versus manual regression verified” qualifiers. The execution failure is resolved; this content review boundary prevents an automatic overwrite of the original table with an incomplete status interpretation.

OpenCode source inspected: [stdin handling](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/cli/src/run/run.ts), [tool-output limit](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/tool-output.ts).

## Rejected follow-up candidate

An additional 0.12.61 prompt candidate was tested read-only and **not deployed**. It completed in 107,372 ms with all nine exact bodies, and improved some citations and verification qualifiers, but independent review found a missing original issue and incomplete older-source coverage. Its two extra prompt rules and version bump were withdrawn; the product source remains identical to the verified v0.12.60 release. `live-v01261-candidate-receipt.json` is retained as rejected-candidate evidence, not acceptance evidence. Solving those semantic errors requires a separately verifiable reconciliation workflow; a model response or successful save alone is insufficient.
