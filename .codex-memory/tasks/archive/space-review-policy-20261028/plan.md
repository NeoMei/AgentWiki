# Space review policy implementation plan

> Execute in this session with delegated independent tasks; user authorizes bounded implementation and design choices.

**Goal:** New Spaces start without review while owners can choose or change policy visibly.
**Architecture:** Existing approvalPolicy is the sole persisted setting. Feature-owned radio choices/editor are shared by creation, header modal and settings card; scoped events synchronize policy without replacing other drafts.
**Tech Stack:** React, NativeSelect where existing selects remain, native radios, ModalDialog, NestJS/Prisma/PostgreSQL.
**Spec:** brief.md and decisions.md.

## Task 1: Server defaults and compatibility
- [x] Add failing tests for omitted/default no-review, explicit always-review, invalid/null values; migrate only future DB defaults; verify existing records unchanged.
- [x] Include bootstrap new-space defaults and preserve existing bootstrap recovery identities/policies.
- [x] Run Space/DTO/bootstrap/approval boundaries and real isolated DB migration checks.

## Task 2: Creation and settings
- [x] Add failing creation tests for default selection, explicit policy payload, reset; implement visible ReviewPolicyOptions.
- [x] Move SpaceReviewPolicyCard to settings top; separate policy writes from basic profile; verify draft preservation and member read-only.

## Task 3: Shared controls and space shell
- [x] Add behavior tests for editor save/failure/permissions/scope and policy sync events.
- [x] Implement radio options, independent owner editor, header modal badge; PATCH only policy and publish successful current-scope events.
- [x] Integrate header and scoped policy-only updates in SpaceView; retain shell/navigation layouts and focus.

## Task 4: Acceptance
- [x] Run related frontend/backend tests, type/lint/build and migration fingerprint gates.
- [x] Local real Chrome create and header/settings journeys, desktop/mobile, permission and error paths.
- [x] Independent review, commit local intended files, update continuity; preserve design/ and existing production state.
