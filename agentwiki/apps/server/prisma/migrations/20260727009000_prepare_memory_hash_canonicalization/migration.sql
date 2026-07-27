BEGIN;

-- The already-published 10000 migration uses PostgreSQL lower()/\s semantics.
-- Reject true ASCII-canonical conflicts first, then temporarily give only rows
-- in old-rule false-conflict groups a unique type. Content is never changed.
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
          btrim(regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'), ' '),
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
      USING HINT = 'No AgentMemory rows, PAT values, or context fields were changed. Resolve true ASCII-canonical duplicates first.';
  END IF;
END
$$;

CREATE TABLE "_AgentMemoryCanonicalizationBridge" (
  "memoryId" TEXT NOT NULL,
  "originalType" TEXT NOT NULL,
  "bridgeType" TEXT NOT NULL,
  CONSTRAINT "_AgentMemoryCanonicalizationBridge_pkey" PRIMARY KEY ("memoryId"),
  CONSTRAINT "_AgentMemoryCanonicalizationBridge_bridgeType_key" UNIQUE ("bridgeType"),
  CONSTRAINT "_AgentMemoryCanonicalizationBridge_memoryId_fkey"
    FOREIGN KEY ("memoryId") REFERENCES "AgentMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

WITH old_rule_conflicts AS (
  SELECT
    "agentId",
    "spaceId",
    "type",
    md5(lower(trim(regexp_replace("content", '\s+', ' ', 'g')))) AS old_hash
  FROM "AgentMemory"
  GROUP BY
    "agentId",
    "spaceId",
    "type",
    md5(lower(trim(regexp_replace("content", '\s+', ' ', 'g'))))
  HAVING COUNT(*) > 1
)
INSERT INTO "_AgentMemoryCanonicalizationBridge" ("memoryId", "originalType", "bridgeType")
SELECT
  memory."id",
  memory."type",
  '__agentwiki_memory_canonical_bridge__:' || memory."id"
FROM "AgentMemory" memory
JOIN old_rule_conflicts conflict
  ON conflict."agentId" = memory."agentId"
 AND conflict."spaceId" = memory."spaceId"
 AND conflict."type" = memory."type"
 AND conflict.old_hash = md5(lower(trim(regexp_replace(memory."content", '\s+', ' ', 'g'))));

UPDATE "AgentMemory" memory
SET "type" = bridge."bridgeType"
FROM "_AgentMemoryCanonicalizationBridge" bridge
WHERE memory."id" = bridge."memoryId";

DO $$
DECLARE
  remaining_old_conflicts BIGINT := 0;
BEGIN
  SELECT COUNT(*) INTO remaining_old_conflicts
  FROM (
    SELECT 1
    FROM "AgentMemory"
    GROUP BY
      "agentId",
      "spaceId",
      "type",
      md5(lower(trim(regexp_replace("content", '\s+', ' ', 'g'))))
    HAVING COUNT(*) > 1
  ) conflicts;

  IF remaining_old_conflicts > 0 THEN
    RAISE EXCEPTION 'legacy canonicalization bridge could not isolate % conflict group(s)', remaining_old_conflicts;
  END IF;
END
$$;

COMMIT;
