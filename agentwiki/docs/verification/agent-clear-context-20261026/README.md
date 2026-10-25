# Clear conversation context — v0.12.61

This release adds an Eraser button beside the new-conversation and history controls. After a new session is created successfully, it replaces the current tab and starts with no previous conversation turns, draft, explicit references or staged notes. Other tabs and historical sessions remain accessible; the current page or directory remains the source. Running/queued, pending send/create/load and cancellation states disable clearing. Failures retain the original conversation and composer.

The implementation also prevents a cleared empty-state draft from returning after closing the new tab, and respects user focus changes during slow session creation. Chromium's native blur when disabling a button is covered.

Source implementation: `0c0777f9`. Final feature verification: all 169 client test files / 2830 tests passed, including 98 panel tests and 35 note bridge tests; TypeScript, changed-source ESLint, production build and diff checks passed. Local Chrome 155 tested the real component with isolated API responses; the corrected visual run used the actual build CSS in English and Chinese at 1280px and 390px. Temporary browser fixtures and services were removed.

The previous prompt-only candidate that briefly used version 0.12.61 was rejected and reverted before this feature. Its receipts under `agent-failure-20261026` are historical rejected evidence; none is acceptance evidence for this release. This release does not add those prompt changes or claim that generated Bug summary contents are semantically complete.

Deployed and published as [v0.12.61](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.61) at exact commit `4075638e390d9f6c8174721761a4a232b7d014a3`. Production host verification matched all 1436 source files and all expected package versions. API, worker and frontend are active; all five health fields are `ok`. Public HTTPS verification matched the production entry HTML and all five entry assets.

A newly verified paired backup remains server-private at `/var/backups/agentwiki/agent-clear-context-v01261.IrzEQtJp`. The previous application tree is `/root/agentwiki-previous-20261026055218`. No migration was pending. GitHub release is public, non-draft, non-prerelease and latest; the annotated tag resolves to the exact deployed commit.

`local-browser-interactions.json` excludes the original fixture's invalid geometry checks. `local-browser-visual.json` and the four `real-css.png` screenshots contain the corrected CSS verification. Production browser acceptance passed: an isolated draft was cleared into a fresh session, focus returned to the composer, other tabs and history remained accessible, and refresh preserved the empty new session and current-page source. No model request or page write was performed; see `production-browser.json`.
