<!-- codex-memory:template=design-rules:v2 -->

# Design Rules

This file is the entry point for frontend design rules in this project.

## Required Reading Order

For frontend page design, component selection, page implementation, or visual adjustment, read these files in order:

1. `frontend-design-standards.md`
2. `frontend-page-workflow.md`
3. `component-reuse.md`
4. this file

## Rule Priority

If rules conflict, use this priority order:

1. This file (`design-rules.md`) for project-specific overrides
2. `frontend-design-standards.md` for visual and component standards
3. `frontend-page-workflow.md` for execution order and delivery flow
4. `component-reuse.md` for shared component usage

## Project-Specific Overrides

- This project should keep a product-style visual language
- Do not freely introduce a second component system
- If the current tech stack is incompatible with `shadcn/ui`, state that clearly before implementation
- Prefer continuity with the project's existing frontend language over inventing a new style
- Markdown editing uses one Obsidian-like workspace with mutually exclusive Edit and Preview states; do not reintroduce a side-by-side editor/preview layout
- All new user-visible interface copy must support both Simplified Chinese and English through the shared language context; language selection must persist across reloads

## Notes

- `frontend-design-standards.md` is the stable default visual standard
- `frontend-page-workflow.md` is the stable default page execution process
- If a frontend rule becomes repeatedly reused in this project, summarize it here as a project-specific override
