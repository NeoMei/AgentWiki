-- Benchmark (5000 rows, 2048d halfvec, 50 queries) showed the default HNSW
-- build (m=16, ef_construction=64) at the default ef_search=40 returns only
-- ~88% recall@10 (worst query 20%). Rebuilding with m=32 / ef_construction=256
-- and ef_search=200 measured 100% recall@10 at ~19ms vs ~12ms baseline.
DROP INDEX IF EXISTS "Page_embeddingVector_hnsw";

-- Tables are small at deploy time, so a non-concurrent build is safe here;
-- CREATE INDEX CONCURRENTLY cannot run inside the migration transaction.
CREATE INDEX "Page_embeddingVector_hnsw"
  ON "Page" USING hnsw ("embeddingVector" public.halfvec_cosine_ops)
  WITH (m = 32, ef_construction = 256);

-- Applies to every future connection (Prisma pool reconnects pick this up
-- after the post-deploy service restart). current_database() keeps the
-- migration portable across dev/test/production database names.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET hnsw.ef_search = 200', current_database());
END
$$;
