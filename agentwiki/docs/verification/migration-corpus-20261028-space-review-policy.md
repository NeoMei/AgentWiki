# 2026-10-28 Space approval default migration review

New migration: `20261028090000_default_space_no_review/migration.sql`.

The only SQL statement is `ALTER TABLE "Space" ALTER COLUMN "approvalPolicy" SET DEFAULT 'no-review';`. It changes future omitted-column inserts only. It contains no UPDATE/backfill, DROP, grant or cross-schema operation, and preserves all existing Space values and pending ChangeSets. Prisma's default and the ordinary/bootstrap creation paths match this new default.

New file SHA256: `93dd51e639e70ed28d35c0ccd814579fb9a6e2525d0d4b5f2d132e6f671d51a2`.

Reviewed corpus: 68 entries, SHA256 `7f8648decb8c3ab0de310e2603c4d3023584c151d1713c3a5697084f4c085f0a`. Removing the sole new SQL yields the previous reviewed corpus SHA256 `5199e2d702c345c64b0438daad1cfa17da4c0aa624f5d62dc0fc762c58a833fc`; no historical migration bytes changed. Root and independent copy_button_review inspected the SQL; the independent reviewer recomputed both corpus digests and verified owner-only mutation/recovery boundaries.

Real isolated PostgreSQL verification covered omitted-column inserts, existing policies across the ALTER DEFAULT, explicit always-review, and later metadata updates. Fresh corpus safety and DB tests passed with cleanup. This document records local migration review and does not claim production deployment.
