# Agent chat feedback and compact review
Base: v0.12.34 479419eff227a09350dd7cdc695450de238bb894
Workspace: `/Users/neomei/.codex/worktrees/agent-chat-feedback/AgentWiki `
All git calls MUST specify --work-tree="$PWD" from workspace root (common core.worktree points elsewhere).
## Status
Released and deployed as v0.12.37, commit 9b7a3b90efd538bcea067fbab0344fec856d9b6f. Integrated v0.12.36; 7518 pass / 6 existing skips; build, typecheck, lint, independent integrated review and coordinated backup passed. Production source/public assets, real provider question/proposal, browser progress/compact review and draft-vs-explicit-Save database readbacks passed. Temporary test resources soft-deleted and task browser closed; user SSH connection retained. See agentwiki/docs/verification/agent-chat-feedback-20261015/deployment.json.

## Goal
Embedded chat must visibly respond while executing. Compact the edit review by removing duplicate summaries/actions and folding optional details.
## Constraints
Chinese/English, existing styling, authenticated session access, lease fence, cancellation, editor draft acceptance vs explicit Save, reading explicit direct mode, CAS all preserved. No raw reasoning/tool arguments/provider text as process feedback. No fake token animation. No production write/deploy in this task.
## Task 1 server
Add sanitized structured execution progress for sessions via existing task result JSON while running (no schema migration), expose independent optional progress DTO (whitelisted phases plus bounded attempt count) only queued/running, terminal progress hidden. Runtime typed onProgress callback, router preparing/catalog and retry attempt, runner spawn/waiting and known step_start/generating, finalizing after output complete. Deduplicate phase events; persist using same authorization/active lease checks and serial progress writes as answers. Failures/cancel cannot overwrite terminal state. Never expose raw JSON, model secrets, reasoning, tool args. Keep answer callback invariant. Test runner/router/queue/service.
## Task 2 frontend
Add immediate sending/queued/running indicator even when no progressText; spinner (reduced-motion friendly), elapsed time while active, readable real phase and retry count, existing stop. Use progress DTO from task 1; empty/older server fallback meaningful running status. Stop timer after terminal/unmount. Compact AssistCandidateReview only where AgentSessionPanel opts in: no duplicate summary/header; main summary of change count and primary Accept to draft/Discard stay visible, detailed diff/individual edits/full compare/download collapse under View changes. Single-item no duplicate per-edit accept; multiple-item partial acceptance remains inside details. Conflict/failure/truncation/permission warning always visible. Existing reading/editing/direct boundaries unchanged. Browser fixture should simulate real staged events and blank answer for >5 seconds, then result, not insert fake progressText.
## Validation
Targeted meaningful red-green tests, client full suite, relevant server tests, both build/typecheck, lint changed files, independent task and final review, desktop/narrow browser execution/stop/proposal accept/draft Save behavior.
