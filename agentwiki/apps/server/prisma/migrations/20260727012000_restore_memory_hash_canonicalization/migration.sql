BEGIN;

-- Restore the original Memory context after the immutable 10000 migration and
-- the ASCII-aligned 11000 migration have completed. Recheck before restoring so
-- the unique key cannot be broken, then compute the final canonical hash.
LOCK TABLE "AgentMemory" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  conflict_groups BIGINT := 0;
  conflict_rows BIGINT := 0;
BEGIN
  WITH normalized AS (
    SELECT
      memory."agentId",
      memory."spaceId",
      COALESCE(bridge."originalType", memory."type") AS effective_type,
      md5(
        translate(
          btrim(regexp_replace(memory."content", E'[ \x09-\x0D]+', ' ', 'g'), ' '),
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          'abcdefghijklmnopqrstuvwxyz'
        )
      ) AS canonical_hash
    FROM "AgentMemory" memory
    LEFT JOIN "_AgentMemoryCanonicalizationBridge" bridge
      ON bridge."memoryId" = memory."id"
  ), conflicts AS (
    SELECT COUNT(*) AS row_count
    FROM normalized
    GROUP BY "agentId", "spaceId", effective_type, canonical_hash
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*), COALESCE(SUM(row_count), 0)
    INTO conflict_groups, conflict_rows
  FROM conflicts;

  IF conflict_groups > 0 THEN
    RAISE EXCEPTION 'canonical memory hash conflict: % group(s), % row(s); refusing to restore bridged context', conflict_groups, conflict_rows
      USING HINT = 'No content or original Memory type was changed. Resolve true ASCII-canonical duplicates before retrying.';
  END IF;
END
$$;

UPDATE "AgentMemory" memory
SET "type" = bridge."originalType"
FROM "_AgentMemoryCanonicalizationBridge" bridge
WHERE memory."id" = bridge."memoryId";

UPDATE "AgentMemory"
SET "contentHash" = md5(
  translate(
    btrim(regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'), ' '),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  )
)
WHERE "contentHash" IS DISTINCT FROM md5(
  translate(
    btrim(regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'), ' '),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  )
);

DROP TABLE "_AgentMemoryCanonicalizationBridge";

COMMIT;
