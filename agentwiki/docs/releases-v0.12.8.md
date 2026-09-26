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

Production acceptance (2026-09-26):

- Deployed v0.12.8 from release commit `22149924df2db68c5bb200c090714b143ec5dbfa`; 14 deployed release files match the candidate SHA-256 hashes.
- API, Worker and Frontend are active. Public health reports status, database, Redis, audit persistence and attachment storage all ok. Prisma reports no pending migrations.
- Logged-in browser verification confirms the default file picker, local-file guidance and board.json support text. A document without tasks produces the explicit inline error; existing board content is preserved.
- Full local-file upload through the browser was not exercised in this deployment check and remains unverified. File-picker visibility and invalid-document handling do not count as successful upload acceptance.
- Paired database/attachment backup: `/var/backups/agentwiki/v0128.a3sODZUZ`; previous application tree: `/root/agentwiki-previous-20260926134350`.
