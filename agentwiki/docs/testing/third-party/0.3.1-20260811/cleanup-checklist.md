# Cleanup Checklist

Sanitized isolated-root label: `agentwiki-3pt.<ephemeral>` (the full local filesystem path is intentionally not recorded).

| Resource type | Sanitized name | Owning user | Space | Creation case | Deletion method | Deletion time | Verifier | Verification method | Result |
|---|---|---|---|---|---|---|---|---|---|
| Isolated client home | `agentwiki-3pt.<ephemeral>/codex` | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm path is absent and root marker is removed | PENDING |
| Isolated client home | `agentwiki-3pt.<ephemeral>/claude` | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm path is absent and root marker is removed | PENDING |
| Isolated client home | `agentwiki-3pt.<ephemeral>/opencode` | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm path is absent and root marker is removed | PENDING |
| Synthetic knowledge fixture set | `knowledge-a` (`overview.md`, `setup.md`, `obsolete.md`) | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm all three files are absent with isolated root removal | PENDING |
| Synthetic knowledge fixture set | `knowledge-b` (`overview.md`, `setup.md`, `obsolete.md`) | Codex controller | N/A (local) | Task 2 | Remove isolated root after Task 8 | PENDING | NOT_RECORDED | Confirm all three files are absent with isolated root removal | PENDING |
| Local root marker | `agentwiki-3pt-root` (mode `0600`) | Codex controller | N/A (local) | Task 2 | Remove marker after isolated-root removal | PENDING | NOT_RECORDED | Confirm marker is absent and mode was `0600` before removal | PENDING |
