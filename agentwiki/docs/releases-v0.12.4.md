# AgentWiki v0.12.4

Taskboard canvas synced from upstream project-taskboard ba771da: arbitrary task tree depth.

- Canvas columns are generated along the real parent_id path instead of a fixed three-column layout; clicking a card with children expands the next level.
- Clickable breadcrumbs return to any ancestor; deep paths get a wider scrollable canvas (245px columns, auto width).
- Path nodes are highlighted, and the running-table locate button expands the full ancestry.
- Client-only change; Local Sync and sync protocol versions remain 0.10.0 and 0.6.0.
