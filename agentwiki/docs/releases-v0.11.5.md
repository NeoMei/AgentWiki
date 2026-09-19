# AgentWiki v0.11.5

Native integration of project-taskboard (github.com/NeoMei/project-taskboard) as a per-Space task board.

- New schema: ProjectBoard (one per Space) and ProjectBoardTask (flat hierarchical task rows); applied via prisma migrate deploy during the release.
- Superpowers plan import: paste a plan to create phase/task/step hierarchies; re-import refreshes planning fields while preserving live execution status.
- Agent status reporting REST API under /api/spaces/:spaceId/taskboard with wire-compatible payloads (status, current_step, upsert, import-plan).
- Space workspace adds a taskboard page: phase rail, hierarchical task table, status/steps editing, running-tasks panel, and plan import.
- Local Sync and sync protocol versions remain 0.10.0 and 0.6.0. The independent Obsidian Sync release remains 0.5.1.
