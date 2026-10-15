# English Guide screenshot localization

- Root cause reproduced on the production English `/guide`: translated captions still pointed at six Chinese images in nine positions.
- `guideScreenshots.ts` selects explicit Chinese/English assets for every position. Eight new English images include separate local-sync preview/result examples.
- User authorized creating an English example and then publishing. Product Handbook, Handbook Assistant, Release checklist and Alex Morgan are fictional documentation data. Images label sample data; transcript cards label illustrative conversations. No model run, live MCP publication or private production data is represented as an actual execution receipt.
- Captures use the real AgentList, SpaceMembers, PagePreview and AgentDetail components. The local-only fixture rejects writes; the capture script rejects API/remote traffic. Recreate with the client dev server and `node scripts/capture-guide-screenshots.mjs http://127.0.0.1:5194`.
- All eight images visually reviewed; capture DOM contains no CJK text. `capture.json` records image dimensions and text.
- Browser acceptance at 1440 and 390 pixels exercised EN → ZH → EN, decoded all nine image positions, checked resource language, natural aspect ratio, zero horizontal overflow and zero page errors. See `local-browser.json`. The same checks also pass against the final built client on localhost:5195 (`build-browser.json`).
- Regression was first observed failing because English retained `/screenshots/step1-agent-list.png`; the final focused suite passes 7/7.
- English image height is automatic, contain-fit, with the local-sync grid aligned at the start to avoid image stretching. Chinese sizing/source paths remain unchanged.
- Self-review: all references mapped; test-only renderer is outside production entry graph; production instructions no longer describe English examples as verified OpenCode runs. No authentication, grant, policy or business-logic changes.

## Release integration

- Integrated directory navigation release v0.12.38 (53064514), then its documentation receipt (9c9bdcac). Only frontend source changed since the full regression baseline; server business code, DB schema, sync protocol and Local Sync are identical.
- Updated the screenshot fixture to import SpaceWorkspaceScope from its new module, re-captured the examples, rebuilt all packages, and re-ran the final production build browser checks.
- Initial unconfigured `pnpm test` stopped at missing test database variables. The supported `pnpm test:full` runner provisioned its isolated environment and passed: runtime 309/1 skip, DB 239, server 3243/4 skip, client 2590, protocol 140, Local Sync 998/1 skip (7519 passed, 6 existing skipped).
- After v0.12.38 integration, the first serial client run had 2609 passes and one existing KnowledgeGraph.grouped test failure at line 48. The graph source/test are unchanged; isolated rerun passes 13/13. The complete rerun is recorded in release-gates.json.
- Final full parallel rerun: 2609 passes / 1 failure in the same unchanged graph file, now at line 180 (Fit graph timing), after the isolated 13/13 pass. This is recorded as an outstanding test-flakiness limitation; no claim that the final complete client suite is green or that the graph defect is fixed. All other 158 files pass. Guide and both built-page viewport/language checks pass.
