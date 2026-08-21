-- Semantic search moves from JSON embeddings compared in application memory to
-- native pgvector halfvec columns with an HNSW cosine index. halfvec(2048) is
-- used because pgvector HNSW indexes cap vector columns at 2000 dimensions
-- while halfvec supports up to 4000.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

ALTER TABLE "Page" ADD COLUMN "embeddingVector" public.halfvec(2048);

-- Convert existing JSON embeddings (all generated as text-embedding-v4 2048d).
UPDATE "Page"
SET "embeddingVector" = ("embedding" #>> '{}')::public.halfvec
WHERE "embedding" IS NOT NULL
  AND jsonb_array_length("embedding") = 2048;

ALTER TABLE "Page" DROP COLUMN "embedding";

CREATE INDEX "Page_embeddingVector_hnsw" ON "Page" USING hnsw ("embeddingVector" public.halfvec_cosine_ops);
