CREATE TABLE "SpaceGraphState" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "wikilinkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "similarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "similarThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.86,
    "llmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastContentHash" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastLlmChangeSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceGraphState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaceGraphState_spaceId_key" ON "SpaceGraphState"("spaceId");

ALTER TABLE "SpaceGraphState" ADD CONSTRAINT "SpaceGraphState_spaceId_fkey"
FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
