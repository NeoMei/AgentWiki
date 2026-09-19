# AgentWiki v0.11.8

Taskboard page redesigned to faithfully match the project-taskboard 项目全景 UI.

- Top phase milestone road with status dot counts and scroll/jump controls (upstream e27b53c style).
- Topology canvas: phase root, module, and task/step nodes laid out in columns with SVG wires; three-stage signals, task-type labels, and per-node time text.
- Right inspector panel: three-stage status rows, scope and history, time progress, spec source, execution tasks, acceptance, next step — plus AgentWiki additions (status editor, add-subtask).
- Running-tasks table with a locate-node jump; status legend and coverage notes footer.
- No schema or API changes; Local Sync and sync protocol versions remain 0.10.0 and 0.6.0.
