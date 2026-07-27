BEGIN;

-- Canonicalization is deliberately locale-independent: collapse and trim only
-- ASCII whitespace, lowercase only ASCII A-Z, and preserve all other code points.
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
      md5(
        translate(
          btrim(
            regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'),
            ' '
          ),
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          'abcdefghijklmnopqrstuvwxyz'
        )
      ) AS canonical_hash
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
      USING HINT = 'No AgentMemory rows were deleted or changed. Inspect ASCII-canonical duplicates and preserve the intended memories.';
  END IF;
END
$$;

UPDATE "AgentMemory"
SET "contentHash" = md5(
  translate(
    btrim(
      regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'),
      ' '
    ),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  )
)
WHERE "contentHash" IS DISTINCT FROM md5(
  translate(
    btrim(
      regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'),
      ' '
    ),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  )
);

COMMIT;
