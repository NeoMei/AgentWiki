# AgentWiki v0.12.8

Repairs taskboard imports so users can select and upload local plans or board.json from the web interface.

- Import opens with a visible file picker, shows the selected filename and read progress, and explains that entering a local path does not upload a file.
- Supports Superpowers Markdown plans and local project-taskboard board.json. JSON imports validate the task tree, status and timestamps, and exclude server claim and actor history fields.
- Empty files, read failures, invalid task data and documents without executable tasks report actionable errors in the import panel.
- Root navigation includes all top-level nodes. Empty boards hide the implementation rail, matching updated project-taskboard behavior.
- No database schema migration or sync package upgrade is required.

Validation:

- 5 targeted suites / 40 tests passed across the taskboard UI, view model, parser, service and task core.
- Client and server production builds passed.
- Runtime contract checks: 33 passed; final v0.12.8 application version alignment passed.
- Targeted ESLint passed with zero errors and one existing unused-variable warning.
- Production deployment and browser acceptance are tracked separately; SSH authentication is currently unavailable.
