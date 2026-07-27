BEGIN;

-- Revoke the deprecated plaintext PAT column before removing it. The count and
-- rotation warning are emitted before any value is cleared.
LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
  legacy_pat_count BIGINT := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'apiKey'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM "User" WHERE "apiKey" IS NOT NULL'
      INTO legacy_pat_count;
    RAISE NOTICE 'Legacy User.apiKey count: %. Any non-zero count requires forced PAT rotation.', legacy_pat_count;
    IF legacy_pat_count > 0 THEN
      RAISE WARNING 'Found % legacy User.apiKey value(s); revoke them now and force every affected user to rotate to ApiKeyCredential.', legacy_pat_count;
    END IF;
    EXECUTE 'UPDATE "User" SET "apiKey" = NULL WHERE "apiKey" IS NOT NULL';
  END IF;
END
$$;
DROP INDEX IF EXISTS "User_apiKey_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "apiKey";

-- Match the application hash (lowercase, collapse whitespace, then trim).
-- Hold writes while checking and updating so no new collision can race in.
LOCK TABLE "AgentMemory" IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  conflict_groups BIGINT := 0;
  conflict_rows BIGINT := 0;
BEGIN
  WITH normalized AS (
    SELECT
      "agentId",
      "spaceId",
      "type",
      md5(lower(trim(regexp_replace("content", '\s+', ' ', 'g')))) AS canonical_hash
    FROM "AgentMemory"
  ), conflicts AS (
    SELECT COUNT(*) AS row_count
    FROM normalized
    GROUP BY "agentId", "spaceId", "type", canonical_hash
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*), COALESCE(SUM(row_count), 0)
    INTO conflict_groups, conflict_rows
  FROM conflicts;

  IF conflict_groups > 0 THEN
    RAISE EXCEPTION 'canonical memory hash conflict: % group(s), % row(s); resolve manually before retrying', conflict_groups, conflict_rows
      USING HINT = 'No AgentMemory rows were deleted or changed. Inspect normalized duplicates and preserve the intended memories.';
  END IF;
END
$$;

UPDATE "AgentMemory"
SET "contentHash" = md5(lower(trim(regexp_replace("content", '\s+', ' ', 'g'))))
WHERE "contentHash" IS DISTINCT FROM md5(lower(trim(regexp_replace("content", '\s+', ' ', 'g'))));

COMMIT;
