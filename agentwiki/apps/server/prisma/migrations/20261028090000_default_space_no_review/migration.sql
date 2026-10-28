-- Change only the default for future Spaces; preserve existing policies.
ALTER TABLE "Space" ALTER COLUMN "approvalPolicy" SET DEFAULT 'no-review';
