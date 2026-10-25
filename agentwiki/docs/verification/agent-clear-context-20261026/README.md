# Clear conversation context — v0.12.61

This release adds an Eraser button beside the new-conversation and history controls. After a new session is created successfully, it replaces the current tab and starts with no previous conversation turns, draft, explicit references or staged notes. Other tabs and historical sessions remain accessible; the current page or directory remains the source. Running/queued, pending send/create/load and cancellation states disable clearing. Failures retain the original conversation and composer.

The implementation also prevents a cleared empty-state draft from returning after closing the new tab, and respects user focus changes during slow session creation. Chromium's native blur when disabling a button is covered.

Source implementation: `0c0777f9`. Final feature verification: all 169 client test files / 2830 tests passed, including 98 panel tests and 35 note bridge tests; TypeScript, changed-source ESLint, production build and diff checks passed. Local Chrome 155 tested the real component with isolated API responses; the corrected visual run used the actual build CSS in English and Chinese at 1280px and 390px. Temporary browser fixtures and services were removed.

The previous prompt-only candidate that briefly used version 0.12.61 was rejected and reverted before this feature. Its receipts under `agent-failure-20261026` are historical rejected evidence; none is acceptance evidence for this release. This release does not add those prompt changes or claim that generated Bug summary contents are semantically complete.

Deployment will use a frozen Git commit, a newly verified paired backup, a source manifest and independent host/public checks. Actual deployment and publication receipts are recorded separately after completion.
